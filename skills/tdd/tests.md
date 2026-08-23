# Good and Bad Tests

## Required test properties

Write tests that meet all five requirements:

1. Exercise observable behaviour through a public interface.
2. Use only the public API of the unit under test.
3. Survive any internal refactor that does not change behaviour.
4. Have a name that states WHAT behaviour it checks.
5. Assert exactly one logical outcome.

```typescript
test("user can checkout with valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});
```

## Prohibited test properties

Avoid these test patterns:

1. Mock an internal collaborator.
2. Call a private method.
3. Assert on a mock's call count or call order.
4. Verify through a side channel instead of the public interface.
5. Restate the implementation in the expected value.

```typescript
test("createUser saves to database", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});
```

```typescript
test("createUser makes user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
```

## Non-tautological expected values

Use an independent literal for the expected value, rather than recomputing it
from the implementation.

```typescript
test("calculateTotal sums line items", () => {
  const items = [{ price: 10 }, { price: 5 }];
  const expected = items.reduce((sum, i) => sum + i.price, 0);
  expect(calculateTotal(items)).toBe(expected);
});
```

```typescript
test("calculateTotal sums line items", () => {
  expect(calculateTotal([{ price: 10 }, { price: 5 }])).toBe(15);
});
```
