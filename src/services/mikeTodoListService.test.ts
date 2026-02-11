import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __mikeTodoListTestables } from "./mikeTodoListService.js";

const addDays = (ymd: string, days: number): string => {
  const base = new Date(`${ymd}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const buildTask = (overrides: Record<string, any> = {}): any => {
  return {
    content: "Task",
    id: overrides.id ?? "task-1",
    ...overrides,
  };
};

describe("mikeTodoListService recurring task rendering", () => {
  it("includes recurring tasks due on the current day", () => {
    const today = "2026-02-11";
    const tasks = [
      buildTask({
        due: {
          date: today,
          is_recurring: true,
        },
        id: "recurring-today",
      }),
    ];

    const visible = __mikeTodoListTestables.filterVisibleTasks(tasks, { startYmd: today });
    assert.equal(visible.length, 1);
    assert.equal(String(visible[0].id), "recurring-today");
  });

  it("includes recurring tasks due within a requested date range", () => {
    const start = "2026-02-11";
    const weeklyDue = addDays(start, 7);
    const tasks = [
      buildTask({
        due: {
          date: weeklyDue,
          is_recurring: true,
        },
        id: "recurring-weekly",
      }),
    ];

    const visible = __mikeTodoListTestables.filterVisibleTasks(tasks, {
      endYmd: addDays(start, 7),
      startYmd: start,
    });
    assert.equal(visible.length, 1);
    assert.equal(String(visible[0].id), "recurring-weekly");
  });

  it("keeps non-recurring filtering behavior unchanged", () => {
    const start = "2026-02-11";
    const tasks = [
      buildTask({ due: { date: addDays(start, -1), is_recurring: false }, id: "past" }),
      buildTask({ due: { date: start, is_recurring: false }, id: "today" }),
      buildTask({ due: { date: addDays(start, 2), is_recurring: false }, id: "future" }),
      buildTask({ due: undefined, id: "no-due" }),
    ];

    const visible = __mikeTodoListTestables.filterVisibleTasks(tasks, { startYmd: start });
    const visibleIds = visible.map((task) => String(task.id));
    assert.deepEqual(visibleIds, ["today", "future", "no-due"]);
  });

  it("does not duplicate recurring tasks when duplicate ids are present", () => {
    const today = "2026-02-11";
    const recurringTask = buildTask({
      due: { date: today, is_recurring: true },
      id: "dedupe-id",
    });
    const duplicateTask = buildTask({
      content: "Duplicate recurring",
      due: { date: today, is_recurring: true },
      id: "dedupe-id",
    });

    const visible = __mikeTodoListTestables.filterVisibleTasks(
      [recurringTask, duplicateTask],
      { startYmd: today },
    );
    assert.equal(visible.length, 1);
    assert.equal(String(visible[0].id), "dedupe-id");
  });

  it("skips invalid recurring metadata and logs an error", () => {
    const today = "2026-02-11";
    const invalidRecurring = buildTask({
      due: {
        date: "",
        datetime: "not-a-date",
        is_recurring: true,
      },
      id: "invalid-recurring",
    });
    const errors: any[][] = [];
    const originalError = console.error;
    console.error = (...args: any[]): void => {
      errors.push(args);
    };

    try {
      const visible = __mikeTodoListTestables.filterVisibleTasks([invalidRecurring], {
        startYmd: today,
      });
      assert.equal(visible.length, 0);
      assert.equal(errors.length, 1);
      assert.match(String(errors[0][0]), /Skipping recurring task/);
    } finally {
      console.error = originalError;
    }
  });
});
