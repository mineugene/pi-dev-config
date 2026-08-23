# When to Mock

Mock only at a system boundary. A system boundary is any dependency whose
implementation the repository does not own.

## Boundary policy

1. External API (payment, email, and similar): always mock.
2. Database: use a test database when one is available; mock only when none is
   available.
3. Time or randomness: always mock.
4. File system: use a temporary directory when the OS provides one; mock only
   when it does not.

Use real implementations for your own classes, modules, internal collaborators,
and other dependencies the repository owns.

## Designing for mockability

At a system boundary:

1. Pass the dependency in as a parameter. Do not construct it inside the
   function.

```typescript
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}
```

2. Define one function per external operation. Do not expose one generic function
   with conditional logic.

```typescript
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};
```

Consequences: each mock returns one shape; test setup contains no conditional
logic; a test's exercised endpoints are visible from the mock; each endpoint
keeps its own type.
