import { GenericPool } from '../src/engine/generic'

class TestResource {
    id: number;
    constructor(id: number) { this.id = id; }
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
