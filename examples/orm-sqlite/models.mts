import {
  defineRecord,
  field,
  type RecordSet,
} from 'sqlex';

export class User extends defineRecord({
  table: 'app_user',
  fields: {
    id: field.id(),
    email: field.string({ maxLength: 254, unique: true }),
    active: field.boolean({ default: true }),
  },
}) {
  declare posts: RecordSet<Post>;
}

export class Post extends defineRecord({
  table: 'post',
  fields: {
    id: field.id(),
    author: field.foreignKey(() => User, {
      relatedName: 'posts',
      onDelete: 'cascade',
    }),
    title: field.string({ maxLength: 200 }),
    published: field.boolean({ default: false }),
  },
}) {}
