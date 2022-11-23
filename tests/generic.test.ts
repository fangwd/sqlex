import { GenericPool, QueryHistory } from '../src/engine/generic'
import { sleep } from '../src/utils';

import * as helper from './helper';

const NAME = 'generic';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

class TestResource {
    id: number;
    history: QueryHistory;
    constructor(id: number) { this.id = id; this.history = new QueryHistory(); }
    end() { }
};

function creator() {
    let nextId = 1;
    return () => new TestResource(nextId++);
}

function getWithTimeout(pool: GenericPool<TestResource>, timeout: number): Promise<TestResource | null> {
    return new Promise(resolve => {
        let resolved = false;
        setTimeout(() => {
            if (!resolved) {
                resolve(null);
            }
        }, timeout);
        pool.allocate().then(res => resolve(res))
    })
}

it('should wait when pool is full', async () => {
    const pool = new GenericPool<TestResource>(creator(), 2);
    const res1 = await pool.allocate();
    expect(res1.id).toBe(1)
    const res2 = await pool.allocate();
    expect(res2.id).toBe(2)
    const res3 = await getWithTimeout(pool, 200)
    expect(res3).toBe(null)
    pool.end();
})

it('should use reclaimed resources', async () => {
    const pool = new GenericPool<TestResource>(creator(), 2);
    const res1 = await pool.allocate();
    expect(res1.id).toBe(1)
    const res2 = await pool.allocate();
    expect(res2.id).toBe(2)
    setTimeout(() => pool.reclaim(res1), 100)
    const res3 = await getWithTimeout(pool, 200)
    expect(res3?.id).toBe(1);
    pool.end();
});

it('should auto-reclaim failed connections', async () => {
    if (helper.DB_TYPE !== 'generic') {
        return;
    }

    const db = helper.connectToDatabase(NAME, undefined, 2);
    for (let i = 0; i < 2; i++) {
        try {
            const conn = await db.pool.getConnection();
            await conn.query('delete from * service_log');
        }
        catch (e) {
            // not releasing
        }
    }

    await sleep(1000);

    const conn = await db.pool.getConnection();
    await conn.query('delete from service_log where id=2');
    conn.release();

    const rows = await db.table('service_log').select('*');
    expect(rows.length).toBe(1);

    await db.end();
})