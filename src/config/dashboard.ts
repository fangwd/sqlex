export interface Dashboard {
  forms: Form[];
}

export interface Form {
  model: string;
  title?: string;
  description?: string;
  widgets: Widget[];
  sections?: Section[];
}

export interface Section {
  title: string;
  description?: string;
  widgets: Widget[];
}

export interface Widget {
  field: string;
  title: string;
  comment: string;
  type: string; // checkbox, dropdown, etc
}
