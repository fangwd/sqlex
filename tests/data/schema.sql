create table user (
  id integer primary key auto_increment,
  email varchar(200) unique,
  password varchar(80),
  first_name varchar(30),
  last_name varchar(100),
  status int,
  first_post_id int
);

create table `group` (
  id integer primary key auto_increment,
  name varchar(200) unique
);

create table user_group (
  id integer primary key auto_increment,
  user_id integer,
  group_id integer,
  date_added datetime default current_timestamp,
  unique (user_id, group_id),
  foreign key (user_id) references user(id),
  foreign key (group_id) references `group`(id)
);


create table membership (
  id integer primary key auto_increment,
  user_id integer,
  group_id integer,
  inviter_id integer, -- membership_invites
  invite_reason varchar(100),
  unique (user_id, group_id),
  foreign key (user_id) references user(id),
  foreign key (inviter_id) references user(id),
  foreign key (group_id) references `group`(id)
);

create table category (
  id integer primary key auto_increment,
  name varchar(200),
  description varchar(200),
  parent_id integer default null,
  foreign key (parent_id) references category(id) on delete set null,
  unique (parent_id, name)
);

create table category_attribute (
  id integer primary key auto_increment,
  category_id integer default null,
  name varchar(80),
  value varchar(1024),
  foreign key (category_id) references category(id) on delete set null,
  unique (category_id, name)
);

create table category_tree (
  id integer primary key auto_increment,
  ancestor_id integer not null,
  descendant_id integer not null,
  distance int,
  foreign key (ancestor_id) references category(id),
  foreign key (descendant_id) references category(id),
  unique (ancestor_id, descendant_id)
);

create table product (
  id integer primary key auto_increment,
  sku char(40) unique,
  name varchar(200),
  price float,
  stock_quantity float,
  status int
);

create table product_category (
  id integer primary key auto_increment,
  product_id integer,
  category_id integer,
  foreign key (product_id) references product(id),
  foreign key (category_id) references category(id),
  unique (product_id, category_id)
);

create table delivery_address (
  id integer primary key auto_increment,
  street_address varchar(100) NOT NULL,
  city varchar(30) NOT NULL,
  state varchar(30) NOT NULL,
  country varchar(30) NOT NULL,
  postal_code varchar(8) NOT NULL,
  unique (street_address, city, state, country)
);

create table `order` (
  id integer primary key auto_increment,
  code char(40) unique,
  date_created datetime default current_timestamp,
  user_id integer default null,
  delivery_address_id integer default null,
  status int,
  foreign key (delivery_address_id) references delivery_address(id),
  foreign key (user_id) references user(id)
);

create table order_item (
  id integer primary key auto_increment,
  order_id integer,
  product_id integer,
  quantity float,
  constraint order_product unique (order_id, product_id),
  foreign key (order_id) references `order`(id) on delete cascade,
  foreign key (product_id) references product(id)
);

create table `order_shipping` (
  order_id integer primary key,
  status int,
  foreign key (order_id) references `order`(id) on delete cascade
);

create table `order_shipping_event` (
  id integer primary key auto_increment,
  order_shipping_id integer,
  event_time datetime,
  event_description char(200),
  foreign key (order_shipping_id) references order_shipping(order_id) on delete cascade,
  unique (order_shipping_id, event_time)
);

create table `store` (
  id integer primary key auto_increment,
  name varchar(200) unique
);

create table `store_product` (
  id integer primary key auto_increment,
  store_id integer,
  product_id integer,
  price float,
  unique (store_id, product_id),
  foreign key (store_id) references store(id),
  foreign key (product_id) references product(id)
);

create table post(
  id integer primary key auto_increment,
  title varchar(100),
  user_id int,
  foreign key (user_id) references user(id)
);

create table comment(
  id integer primary key auto_increment,
  post_id int,
  parent_id integer default null,
  content varchar(100),
  foreign key (parent_id) references comment(id) on delete cascade,
  foreign key (post_id) references post(id) on delete cascade
);

alter table user add foreign key (first_post_id) references post(id);

create table service_log(
  id integer primary key auto_increment,
  product_code char(40),
  customer_email varchar(60),
  service_time datetime
);

create table employee (
  id integer primary key auto_increment,
  code varchar(60) not null,
  ecode varchar(60),
  name varchar(60),
  constraint uk_employee unique (code),
  constraint uk_employee2 unique (ecode)
);