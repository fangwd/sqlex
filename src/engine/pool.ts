type Client<Item> = {
  resolve: (connection: Item) => void;
  reject: (reason: any) => void;
};

export class SimplePool<Item extends { end: () => void }> {
  pool: Array<Item>;
  claimed: Array<Item>;
  queue: Array<Client<Item>>;

  constructor(private create: () => Item, public maxSize: number = 2) {
    this.pool = [];
    this.claimed = [];
    this.queue = [];
  }

  get itemCount() {
    return this.pool.length + this.claimed.length;
  }

  getItem(): Promise<Item> {
    return new Promise<Item>((resolve, reject) => {
      const client: Client<Item> = { resolve, reject };
      if (this.pool.length > 0) {
        this.dispatch(client);
      } else if (this.itemCount < this.maxSize) {
        this.pool.push(this.create());
        this.dispatch(client);
      } else {
        this.queue.push(client);
      }
    });
  }

  dispatch(client: Client<Item>) {
    const item = this.pool.shift();
    client.resolve(item);
    this.claimed.push(item);
  }

  reclaim(item: Item) {
    const index = this.claimed.indexOf(item);
    if (index !== -1) {
      this.claimed.splice(index, 1);
    }
    this.pool.push(item);

    if (this.queue.length > 0) {
      const client = this.queue.shift();
      this.dispatch(client);
    }
  }

  async end() {
    for (const item of this.pool) {
      await item.end();
    }
    for (const item of this.claimed) {
      await item.end();
    }
    this.pool.length = 0;
    this.claimed.length = 0;
  }
}
