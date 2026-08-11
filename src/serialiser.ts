import { Result as SelectResult } from './select';
import {
  Model,
  ForeignKeyField,
  RelatedField,
  isValue,
} from './schema';
import { Document, Value } from './types';
import { lcfirst } from './utils';

class DocumentMap {
  map: Map<Model, Map<Value, number>>;
  next: number;

  constructor() {
    this.map = new Map();
    this.next = 1;
  }

  has(model: Model, data: Value | Document) {
    const value = toValue(model, data);
    const map = this.map.get(model);
    return map ? map.has(value) : false;
  }

  add(model: Model, value: Value) {
    let map = this.map.get(model);
    if (!map) {
      map = new Map();
      this.map.set(model, map);
    }
    map.set(value, this.next);
    return this.next++;
  }

  get(model: Model, data: Value | Document) {
    const value = toValue(model, data);
    const map = this.map.get(model);
    return map ? map.get(value) : undefined;
  }
}

interface Task {
  model: Model;
  root: Document;
}

export class JsonSerialiser {
  data: SelectResult;
  map: DocumentMap;
  tasks: Task[];

  constructor(data: SelectResult) {
    this.data = data;
    this.map = new DocumentMap();
    this.tasks = [];
  }

  serialise(model: Model): Document[] | null {
    if (!this.data[model.name]) return null;

    const result: Document[] = [];

    this.data[model.name].forEach((doc, value) => {
      const root = { ...doc };
      this.tasks.push({ model, root });
      result.push(root);
    });

    while (this.tasks.length > 0) {
      const task = this.tasks.shift()!;
      this.processTask(task);
    }

    return result;
  }

  private processTask(task: Task) {
    const rootModel = task.model;
    const root = task.root;

    const pk = rootModel.keyValue(root);

    for (const field of rootModel.fields) {
      if (field instanceof ForeignKeyField) {
        if (!root[field.name]) continue;
        const model = field.referencedField.model;
        const value = model.keyValue(root[field.name] as Document)!;
        if (this.map.has(model, value)) {
          root[field.name] = { [model.keyField()!.name]: value };
        } else {
          if (this.data[model.name]) {
            const row = this.data[model.name].get(value);
            if (row) {
              const doc = { ...row };
              this.tasks.push({ model, root: doc });
              root[field.name] = doc;
              this.map.add(model, value);
            }
          }
        }
      } else if (field instanceof RelatedField) {
        const model = field.referencingField.model;

        if (!this.data[model.name]) continue;

        const rows: Document[] = [];

        this.data[model.name].forEach((doc, value) => {
          if (model.valueOf(doc, field.referencingField) === pk) {
            if (field.throughField) {
              const model2 = field.throughField.referencedField.model;
              const value2 = model.valueOf(doc, field.throughField)!;
              if (this.map.has(model2, value2)) {
                rows.push({ [model2.keyField()!.name]: value2 });
              } else {
                const root = { ...this.data[model2.name].get(value2) };
                this.tasks.push({ model: model2, root });
                this.map.add(model2, value2);
                rows.push(root);
              }
            } else {
              if (this.map.has(model, value)) {
                rows.push({ [model.keyField()!.name]: value });
              } else {
                const root = { ...doc };
                this.tasks.push({ model, root });
                this.map.add(model, value);
                rows.push(root);
              }
            }
          }
        });

        if (field.referencingField.isUnique()) {
          root[field.name] = rows[0] || null;
        } else {
          root[field.name] = rows;
        }
      }
    }
  }
}


function toValue(model: Model, data: Document | Value): Value {
  return isValue(data) ? (data as Value) : model.keyValue(data as Document)!;
}
