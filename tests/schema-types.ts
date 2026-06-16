import type { Database, FilterShape, Identifiable, JsonValue, ParentMutation, RelatedMutation, ScalarValue, TableSpec } from '../src';

export interface OrderShippingRef {
  order: Identifiable;
}

export interface UserRow extends Identifiable {
  id: number;
  email: string | null;
  password: string | null;
  firstName: string | null;
  lastName: string | null;
  status: number | null;
  firstPost: Identifiable | null;
}

export interface UserRelations {
  userGroups?: UserGroupRow[];
  userMemberships?: MembershipRow[];
  inviterMemberships?: MembershipRow[];
  orders?: OrderRow[];
  posts?: PostRow[];
}

export type UserSelected = UserRow & UserRelations;
export type UserFilter = FilterShape<UserRow>;

export interface UserCreate {
  id?: number;
  email?: string | null;
  password?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  status?: number | null;
  firstPost?: Identifiable | ScalarValue | ParentMutation<PostFilter, PostCreate, PostUpdate> | null;
  userGroups?: RelatedMutation<UserGroupFilter, UserGroupCreate, UserGroupUpdate>;
  userMemberships?: RelatedMutation<MembershipFilter, MembershipCreate, MembershipUpdate>;
  inviterMemberships?: RelatedMutation<MembershipFilter, MembershipCreate, MembershipUpdate>;
  orders?: RelatedMutation<OrderFilter, OrderCreate, OrderUpdate>;
  posts?: RelatedMutation<PostFilter, PostCreate, PostUpdate>;
}

export type UserUpdate = Partial<UserCreate>;

export interface GroupRow extends Identifiable {
  id: number;
  name: string | null;
}

export interface GroupRelations {
  userGroups?: UserGroupRow[];
  memberships?: MembershipRow[];
}

export type GroupSelected = GroupRow & GroupRelations;
export type GroupFilter = FilterShape<GroupRow>;

export interface GroupCreate {
  id?: number;
  name?: string | null;
  userGroups?: RelatedMutation<UserGroupFilter, UserGroupCreate, UserGroupUpdate>;
  memberships?: RelatedMutation<MembershipFilter, MembershipCreate, MembershipUpdate>;
}

export type GroupUpdate = Partial<GroupCreate>;

export interface UserGroupRow extends Identifiable {
  id: number;
  user: Identifiable | null;
  group: Identifiable | null;
  dateAdded: Date | null;
}

export interface UserGroupRelations {
}

export type UserGroupSelected = UserGroupRow & UserGroupRelations;
export type UserGroupFilter = FilterShape<UserGroupRow>;

export interface UserGroupCreate {
  id?: number;
  user?: Identifiable | ScalarValue | ParentMutation<UserFilter, UserCreate, UserUpdate> | null;
  group?: Identifiable | ScalarValue | ParentMutation<GroupFilter, GroupCreate, GroupUpdate> | null;
  dateAdded?: Date | null;
}

export type UserGroupUpdate = Partial<UserGroupCreate>;

export interface MembershipRow extends Identifiable {
  id: number;
  user: Identifiable | null;
  group: Identifiable | null;
  inviter: Identifiable | null;
  inviteReason: string | null;
}

export interface MembershipRelations {
}

export type MembershipSelected = MembershipRow & MembershipRelations;
export type MembershipFilter = FilterShape<MembershipRow>;

export interface MembershipCreate {
  id?: number;
  user?: Identifiable | ScalarValue | ParentMutation<UserFilter, UserCreate, UserUpdate> | null;
  group?: Identifiable | ScalarValue | ParentMutation<GroupFilter, GroupCreate, GroupUpdate> | null;
  inviter?: Identifiable | ScalarValue | ParentMutation<UserFilter, UserCreate, UserUpdate> | null;
  inviteReason?: string | null;
}

export type MembershipUpdate = Partial<MembershipCreate>;

export interface CategoryRow extends Identifiable {
  id: number;
  name: string | null;
  description: string | null;
  parent: Identifiable | null;
}

export interface CategoryRelations {
  categories?: CategoryRow[];
  categoryAttributes?: CategoryAttributeRow[];
  ancestorCategoryTrees?: CategoryTreeRow[];
  descendantCategoryTrees?: CategoryTreeRow[];
  products?: ProductRow[];
}

export type CategorySelected = CategoryRow & CategoryRelations;
export type CategoryFilter = FilterShape<CategoryRow>;

export interface CategoryCreate {
  id?: number;
  name?: string | null;
  description?: string | null;
  parent?: Identifiable | ScalarValue | ParentMutation<CategoryFilter, CategoryCreate, CategoryUpdate> | null;
  categories?: RelatedMutation<CategoryFilter, CategoryCreate, CategoryUpdate>;
  categoryAttributes?: RelatedMutation<CategoryAttributeFilter, CategoryAttributeCreate, CategoryAttributeUpdate>;
  ancestorCategoryTrees?: RelatedMutation<CategoryTreeFilter, CategoryTreeCreate, CategoryTreeUpdate>;
  descendantCategoryTrees?: RelatedMutation<CategoryTreeFilter, CategoryTreeCreate, CategoryTreeUpdate>;
  products?: RelatedMutation<ProductFilter, ProductCreate, ProductUpdate>;
}

export type CategoryUpdate = Partial<CategoryCreate>;

export interface CategoryAttributeRow extends Identifiable {
  id: number;
  category: Identifiable | null;
  name: string | null;
  value: string | null;
}

export interface CategoryAttributeRelations {
}

export type CategoryAttributeSelected = CategoryAttributeRow & CategoryAttributeRelations;
export type CategoryAttributeFilter = FilterShape<CategoryAttributeRow>;

export interface CategoryAttributeCreate {
  id?: number;
  category?: Identifiable | ScalarValue | ParentMutation<CategoryFilter, CategoryCreate, CategoryUpdate> | null;
  name?: string | null;
  value?: string | null;
}

export type CategoryAttributeUpdate = Partial<CategoryAttributeCreate>;

export interface CategoryTreeRow extends Identifiable {
  id: number;
  ancestor: Identifiable;
  descendant: Identifiable;
  distance: number | null;
}

export interface CategoryTreeRelations {
}

export type CategoryTreeSelected = CategoryTreeRow & CategoryTreeRelations;
export type CategoryTreeFilter = FilterShape<CategoryTreeRow>;

export interface CategoryTreeCreate {
  id?: number;
  ancestor: Identifiable | ScalarValue | ParentMutation<CategoryFilter, CategoryCreate, CategoryUpdate>;
  descendant: Identifiable | ScalarValue | ParentMutation<CategoryFilter, CategoryCreate, CategoryUpdate>;
  distance?: number | null;
}

export type CategoryTreeUpdate = Partial<CategoryTreeCreate>;

export interface ProductRow extends Identifiable {
  id: number;
  sku: string | null;
  name: string | null;
  price: number | null;
  stockQuantity: number | null;
  status: number | null;
}

export interface ProductRelations {
  categories?: CategoryRow[];
  orderItems?: OrderItemRow[];
  storeProducts?: StoreProductRow[];
}

export type ProductSelected = ProductRow & ProductRelations;
export type ProductFilter = FilterShape<ProductRow>;

export interface ProductCreate {
  id?: number;
  sku?: string | null;
  name?: string | null;
  price?: number | null;
  stockQuantity?: number | null;
  status?: number | null;
  categories?: RelatedMutation<CategoryFilter, CategoryCreate, CategoryUpdate>;
  orderItems?: RelatedMutation<OrderItemFilter, OrderItemCreate, OrderItemUpdate>;
  storeProducts?: RelatedMutation<StoreProductFilter, StoreProductCreate, StoreProductUpdate>;
}

export type ProductUpdate = Partial<ProductCreate>;

export interface ProductCategoryRow extends Identifiable {
  id: number;
  product: Identifiable | null;
  category: Identifiable | null;
}

export interface ProductCategoryRelations {
}

export type ProductCategorySelected = ProductCategoryRow & ProductCategoryRelations;
export type ProductCategoryFilter = FilterShape<ProductCategoryRow>;

export interface ProductCategoryCreate {
  id?: number;
  product?: Identifiable | ScalarValue | ParentMutation<ProductFilter, ProductCreate, ProductUpdate> | null;
  category?: Identifiable | ScalarValue | ParentMutation<CategoryFilter, CategoryCreate, CategoryUpdate> | null;
}

export type ProductCategoryUpdate = Partial<ProductCategoryCreate>;

export interface DeliveryAddressRow extends Identifiable {
  id: number;
  streetAddress: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface DeliveryAddressRelations {
  orders?: OrderRow[];
}

export type DeliveryAddressSelected = DeliveryAddressRow & DeliveryAddressRelations;
export type DeliveryAddressFilter = FilterShape<DeliveryAddressRow>;

export interface DeliveryAddressCreate {
  id?: number;
  streetAddress: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  orders?: RelatedMutation<OrderFilter, OrderCreate, OrderUpdate>;
}

export type DeliveryAddressUpdate = Partial<DeliveryAddressCreate>;

export interface OrderRow extends Identifiable {
  id: number;
  code: string | null;
  dateCreated: Date | null;
  user: Identifiable | null;
  deliveryAddress: Identifiable | null;
  status: number | null;
}

export interface OrderRelations {
  orderItems?: OrderItemRow[];
  orderShipping?: OrderShippingRow | null;
}

export type OrderSelected = OrderRow & OrderRelations;
export type OrderFilter = FilterShape<OrderRow>;

export interface OrderCreate {
  id?: number;
  code?: string | null;
  dateCreated?: Date | null;
  user?: Identifiable | ScalarValue | ParentMutation<UserFilter, UserCreate, UserUpdate> | null;
  deliveryAddress?: Identifiable | ScalarValue | ParentMutation<DeliveryAddressFilter, DeliveryAddressCreate, DeliveryAddressUpdate> | null;
  status?: number | null;
  orderItems?: RelatedMutation<OrderItemFilter, OrderItemCreate, OrderItemUpdate>;
  orderShipping?: RelatedMutation<OrderShippingFilter, OrderShippingCreate, OrderShippingUpdate>;
}

export type OrderUpdate = Partial<OrderCreate>;

export interface OrderItemRow extends Identifiable {
  id: number;
  order: Identifiable | null;
  product: Identifiable | null;
  quantity: number | null;
}

export interface OrderItemRelations {
}

export type OrderItemSelected = OrderItemRow & OrderItemRelations;
export type OrderItemFilter = FilterShape<OrderItemRow>;

export interface OrderItemCreate {
  id?: number;
  order?: Identifiable | ScalarValue | ParentMutation<OrderFilter, OrderCreate, OrderUpdate> | null;
  product?: Identifiable | ScalarValue | ParentMutation<ProductFilter, ProductCreate, ProductUpdate> | null;
  quantity?: number | null;
}

export type OrderItemUpdate = Partial<OrderItemCreate>;

export interface OrderShippingRow extends OrderShippingRef {
  order: Identifiable;
  status: number | null;
}

export interface OrderShippingRelations {
  orderShippingEvents?: OrderShippingEventRow[];
}

export type OrderShippingSelected = OrderShippingRow & OrderShippingRelations;
export type OrderShippingFilter = FilterShape<OrderShippingRow>;

export interface OrderShippingCreate {
  order: Identifiable | ScalarValue | ParentMutation<OrderFilter, OrderCreate, OrderUpdate>;
  status?: number | null;
  orderShippingEvents?: RelatedMutation<OrderShippingEventFilter, OrderShippingEventCreate, OrderShippingEventUpdate>;
}

export type OrderShippingUpdate = Partial<OrderShippingCreate>;

export interface OrderShippingEventRow extends Identifiable {
  id: number;
  orderShipping: OrderShippingRef | null;
  eventTime: Date | null;
  eventDescription: string | null;
}

export interface OrderShippingEventRelations {
}

export type OrderShippingEventSelected = OrderShippingEventRow & OrderShippingEventRelations;
export type OrderShippingEventFilter = FilterShape<OrderShippingEventRow>;

export interface OrderShippingEventCreate {
  id?: number;
  orderShipping?: OrderShippingRef | ScalarValue | ParentMutation<OrderShippingFilter, OrderShippingCreate, OrderShippingUpdate> | null;
  eventTime?: Date | null;
  eventDescription?: string | null;
}

export type OrderShippingEventUpdate = Partial<OrderShippingEventCreate>;

export interface StoreRow extends Identifiable {
  id: number;
  name: string | null;
}

export interface StoreRelations {
  storeProducts?: StoreProductRow[];
}

export type StoreSelected = StoreRow & StoreRelations;
export type StoreFilter = FilterShape<StoreRow>;

export interface StoreCreate {
  id?: number;
  name?: string | null;
  storeProducts?: RelatedMutation<StoreProductFilter, StoreProductCreate, StoreProductUpdate>;
}

export type StoreUpdate = Partial<StoreCreate>;

export interface StoreProductRow extends Identifiable {
  id: number;
  store: Identifiable | null;
  product: Identifiable | null;
  price: number | null;
}

export interface StoreProductRelations {
}

export type StoreProductSelected = StoreProductRow & StoreProductRelations;
export type StoreProductFilter = FilterShape<StoreProductRow>;

export interface StoreProductCreate {
  id?: number;
  store?: Identifiable | ScalarValue | ParentMutation<StoreFilter, StoreCreate, StoreUpdate> | null;
  product?: Identifiable | ScalarValue | ParentMutation<ProductFilter, ProductCreate, ProductUpdate> | null;
  price?: number | null;
}

export type StoreProductUpdate = Partial<StoreProductCreate>;

export interface PostRow extends Identifiable {
  id: number;
  title: string | null;
  user: Identifiable | null;
}

export interface PostRelations {
  users?: UserRow[];
  comments?: CommentRow[];
}

export type PostSelected = PostRow & PostRelations;
export type PostFilter = FilterShape<PostRow>;

export interface PostCreate {
  id?: number;
  title?: string | null;
  user?: Identifiable | ScalarValue | ParentMutation<UserFilter, UserCreate, UserUpdate> | null;
  users?: RelatedMutation<UserFilter, UserCreate, UserUpdate>;
  comments?: RelatedMutation<CommentFilter, CommentCreate, CommentUpdate>;
}

export type PostUpdate = Partial<PostCreate>;

export interface CommentRow extends Identifiable {
  id: number;
  post: Identifiable | null;
  parent: Identifiable | null;
  content: string | null;
}

export interface CommentRelations {
  comments?: CommentRow[];
}

export type CommentSelected = CommentRow & CommentRelations;
export type CommentFilter = FilterShape<CommentRow>;

export interface CommentCreate {
  id?: number;
  post?: Identifiable | ScalarValue | ParentMutation<PostFilter, PostCreate, PostUpdate> | null;
  parent?: Identifiable | ScalarValue | ParentMutation<CommentFilter, CommentCreate, CommentUpdate> | null;
  content?: string | null;
  comments?: RelatedMutation<CommentFilter, CommentCreate, CommentUpdate>;
}

export type CommentUpdate = Partial<CommentCreate>;

export interface ServiceLogRow extends Identifiable {
  id: number;
  productCode: string | null;
  customerEmail: string | null;
  serviceTime: Date | null;
}

export interface ServiceLogRelations {
}

export type ServiceLogSelected = ServiceLogRow & ServiceLogRelations;
export type ServiceLogFilter = FilterShape<ServiceLogRow>;

export interface ServiceLogCreate {
  id?: number;
  productCode?: string | null;
  customerEmail?: string | null;
  serviceTime?: Date | null;
}

export type ServiceLogUpdate = Partial<ServiceLogCreate>;

export interface EmployeeRow extends Identifiable {
  id: number;
  code: string;
  ecode: string | null;
  name: string | null;
}

export interface EmployeeRelations {
}

export type EmployeeSelected = EmployeeRow & EmployeeRelations;
export type EmployeeFilter = FilterShape<EmployeeRow>;

export interface EmployeeCreate {
  id?: number;
  code: string;
  ecode?: string | null;
  name?: string | null;
}

export type EmployeeUpdate = Partial<EmployeeCreate>;

export interface SqlexTables {
  user: TableSpec<UserRow, UserCreate, UserUpdate, UserFilter>;
  User: TableSpec<UserRow, UserCreate, UserUpdate, UserFilter>;
  group: TableSpec<GroupRow, GroupCreate, GroupUpdate, GroupFilter>;
  Group: TableSpec<GroupRow, GroupCreate, GroupUpdate, GroupFilter>;
  user_group: TableSpec<UserGroupRow, UserGroupCreate, UserGroupUpdate, UserGroupFilter>;
  UserGroup: TableSpec<UserGroupRow, UserGroupCreate, UserGroupUpdate, UserGroupFilter>;
  membership: TableSpec<MembershipRow, MembershipCreate, MembershipUpdate, MembershipFilter>;
  Membership: TableSpec<MembershipRow, MembershipCreate, MembershipUpdate, MembershipFilter>;
  category: TableSpec<CategoryRow, CategoryCreate, CategoryUpdate, CategoryFilter>;
  Category: TableSpec<CategoryRow, CategoryCreate, CategoryUpdate, CategoryFilter>;
  category_attribute: TableSpec<CategoryAttributeRow, CategoryAttributeCreate, CategoryAttributeUpdate, CategoryAttributeFilter>;
  CategoryAttribute: TableSpec<CategoryAttributeRow, CategoryAttributeCreate, CategoryAttributeUpdate, CategoryAttributeFilter>;
  category_tree: TableSpec<CategoryTreeRow, CategoryTreeCreate, CategoryTreeUpdate, CategoryTreeFilter>;
  CategoryTree: TableSpec<CategoryTreeRow, CategoryTreeCreate, CategoryTreeUpdate, CategoryTreeFilter>;
  product: TableSpec<ProductRow, ProductCreate, ProductUpdate, ProductFilter>;
  Product: TableSpec<ProductRow, ProductCreate, ProductUpdate, ProductFilter>;
  product_category: TableSpec<ProductCategoryRow, ProductCategoryCreate, ProductCategoryUpdate, ProductCategoryFilter>;
  ProductCategory: TableSpec<ProductCategoryRow, ProductCategoryCreate, ProductCategoryUpdate, ProductCategoryFilter>;
  delivery_address: TableSpec<DeliveryAddressRow, DeliveryAddressCreate, DeliveryAddressUpdate, DeliveryAddressFilter>;
  DeliveryAddress: TableSpec<DeliveryAddressRow, DeliveryAddressCreate, DeliveryAddressUpdate, DeliveryAddressFilter>;
  order: TableSpec<OrderRow, OrderCreate, OrderUpdate, OrderFilter>;
  Order: TableSpec<OrderRow, OrderCreate, OrderUpdate, OrderFilter>;
  order_item: TableSpec<OrderItemRow, OrderItemCreate, OrderItemUpdate, OrderItemFilter>;
  OrderItem: TableSpec<OrderItemRow, OrderItemCreate, OrderItemUpdate, OrderItemFilter>;
  order_shipping: TableSpec<OrderShippingRow, OrderShippingCreate, OrderShippingUpdate, OrderShippingFilter>;
  OrderShipping: TableSpec<OrderShippingRow, OrderShippingCreate, OrderShippingUpdate, OrderShippingFilter>;
  order_shipping_event: TableSpec<OrderShippingEventRow, OrderShippingEventCreate, OrderShippingEventUpdate, OrderShippingEventFilter>;
  OrderShippingEvent: TableSpec<OrderShippingEventRow, OrderShippingEventCreate, OrderShippingEventUpdate, OrderShippingEventFilter>;
  store: TableSpec<StoreRow, StoreCreate, StoreUpdate, StoreFilter>;
  Store: TableSpec<StoreRow, StoreCreate, StoreUpdate, StoreFilter>;
  store_product: TableSpec<StoreProductRow, StoreProductCreate, StoreProductUpdate, StoreProductFilter>;
  StoreProduct: TableSpec<StoreProductRow, StoreProductCreate, StoreProductUpdate, StoreProductFilter>;
  post: TableSpec<PostRow, PostCreate, PostUpdate, PostFilter>;
  Post: TableSpec<PostRow, PostCreate, PostUpdate, PostFilter>;
  comment: TableSpec<CommentRow, CommentCreate, CommentUpdate, CommentFilter>;
  Comment: TableSpec<CommentRow, CommentCreate, CommentUpdate, CommentFilter>;
  service_log: TableSpec<ServiceLogRow, ServiceLogCreate, ServiceLogUpdate, ServiceLogFilter>;
  ServiceLog: TableSpec<ServiceLogRow, ServiceLogCreate, ServiceLogUpdate, ServiceLogFilter>;
  employee: TableSpec<EmployeeRow, EmployeeCreate, EmployeeUpdate, EmployeeFilter>;
  Employee: TableSpec<EmployeeRow, EmployeeCreate, EmployeeUpdate, EmployeeFilter>;
}

export type SqlexDatabase = Database<SqlexTables>;
