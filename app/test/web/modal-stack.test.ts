import { describe, expect, test } from "bun:test";
import { createModalStack, type ModalStackHooks } from "../../src/web/client/modalStack";

interface CountingHooks {
  hooks: ModalStackHooks;
  lockCalls: number;
  unlockCalls: number;
}

function countingHooks(): CountingHooks {
  const counts: CountingHooks = { lockCalls: 0, unlockCalls: 0, hooks: { lock: () => {}, unlock: () => {} } };
  counts.hooks = {
    lock: () => {
      counts.lockCalls++;
    },
    unlock: () => {
      counts.unlockCalls++;
    },
  };
  return counts;
}

describe("createModalStack", () => {
  test("starts closed", () => {
    const counts = countingHooks();
    const stack = createModalStack(counts.hooks);
    expect(stack.isOpen()).toBe(false);
  });

  test("locks on the first push, not on later ones", () => {
    const counts = countingHooks();
    const stack = createModalStack(counts.hooks);
    stack.push(() => {});
    stack.push(() => {});
    expect(counts.lockCalls).toBe(1);
    expect(stack.isOpen()).toBe(true);
  });

  test("unlocks only once the last modal pops, not on intermediate pops", () => {
    const counts = countingHooks();
    const stack = createModalStack(counts.hooks);
    const popA = stack.push(() => {});
    const popB = stack.push(() => {});
    popB();
    expect(counts.unlockCalls).toBe(0);
    expect(stack.isOpen()).toBe(true);
    popA();
    expect(counts.unlockCalls).toBe(1);
    expect(stack.isOpen()).toBe(false);
  });

  test("closeTop calls only the most recently pushed close", () => {
    const counts = countingHooks();
    const stack = createModalStack(counts.hooks);
    const calls: string[] = [];
    stack.push(() => calls.push("first"));
    stack.push(() => calls.push("second"));
    stack.closeTop();
    expect(calls).toEqual(["second"]);
  });

  test("a well-behaved close() calls its own pop, so closeTop shrinks the stack", () => {
    const counts = countingHooks();
    const stack = createModalStack(counts.hooks);
    stack.push(() => {}); // bottom modal, stays open
    const popTop: () => void = stack.push(() => popTop());
    expect(stack.isOpen()).toBe(true);
    stack.closeTop();
    expect(counts.unlockCalls).toBe(0); // the bottom modal is still open
  });

  test("closeAll closes every modal, top to bottom, even when each pops itself", () => {
    const counts = countingHooks();
    const stack = createModalStack(counts.hooks);
    const order: string[] = [];
    const popA = stack.push(() => {
      order.push("a");
      popA();
    });
    const popB = stack.push(() => {
      order.push("b");
      popB();
    });
    stack.closeAll();
    expect(order).toEqual(["b", "a"]);
    expect(stack.isOpen()).toBe(false);
    expect(counts.unlockCalls).toBe(1);
  });

  test("closeAll doesn't hang if a modal never pops itself", () => {
    const counts = countingHooks();
    const stack = createModalStack(counts.hooks);
    let calls = 0;
    stack.push(() => {
      calls++; // misbehaving: never calls pop
    });
    stack.closeAll();
    expect(calls).toBe(1);
  });

  test("pop is a no-op once already popped", () => {
    const counts = countingHooks();
    const stack = createModalStack(counts.hooks);
    const pop = stack.push(() => {});
    pop();
    pop();
    expect(counts.unlockCalls).toBe(1);
  });
});
