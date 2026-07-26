import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildTaskFilter,
  ensureCreatedTaskTags,
  hasDueTime,
  normalizeCreatedTaskDueDate,
  quoteFilterValue,
  RTMClient,
} from "../src/rtm-client.js";

const okResponse = (rsp) => ({
  ok: true,
  json: async () => ({ rsp: { stat: "ok", ...rsp } }),
});

const makeClient = () =>
  new RTMClient({
    apiKey: "api-key",
    sharedSecret: "shared-secret",
    authToken: "auth-token",
  });

const getParams = (url) => new URL(url).searchParams;
const fixedNow = new Date(2026, 4, 22, 12);

afterEach(() => {
  delete globalThis.fetch;
});

describe("RTM filter helpers", () => {
  it("leaves simple filter values unquoted", () => {
    assert.equal(quoteFilterValue("today"), "today");
    assert.equal(quoteFilterValue("2026-05-22"), "2026-05-22");
  });

  it("quotes and escapes complex filter values", () => {
    assert.equal(quoteFilterValue("next Tuesday"), '"next Tuesday"');
    assert.equal(quoteFilterValue('say "hi"'), '"say \\"hi\\""');
  });

  it("builds combined task filters with escaped values", () => {
    assert.equal(
      buildTaskFilter({
        filter: "status:incomplete",
        dueDate: { start: "next Monday", end: "2026-05-22" },
        tag: "work project",
      }),
      '(status:incomplete AND dueAfter:"next Monday" AND dueBefore:2026-05-22 AND tag:"work project")'
    );
  });

  it("detects due times in clock and meridiem formats", () => {
    assert.equal(hasDueTime("2026-05-22 17:30"), true);
    assert.equal(hasDueTime("next Tuesday 5pm"), true);
    assert.equal(hasDueTime("next Tuesday"), false);
  });

  it("ensures created tasks include the required AI tag", () => {
    assert.deepEqual(ensureCreatedTaskTags(), ["AI"]);
    assert.deepEqual(ensureCreatedTaskTags(["work", "AI"]), ["work", "AI"]);
    assert.deepEqual(ensureCreatedTaskTags(["work", ""]), ["work", "AI"]);
  });

  it("normalizes missing and out-of-range created task due dates", () => {
    assert.equal(normalizeCreatedTaskDueDate(undefined, fixedNow), "today");
    assert.equal(normalizeCreatedTaskDueDate("", fixedNow), "today");
    assert.equal(normalizeCreatedTaskDueDate("2026-05-21", fixedNow), "today");
    assert.equal(normalizeCreatedTaskDueDate("2028-05-23", fixedNow), "today");
  });

  it("preserves natural due dates and parseable dates in range", () => {
    assert.equal(normalizeCreatedTaskDueDate("tomorrow", fixedNow), "tomorrow");
    assert.equal(normalizeCreatedTaskDueDate("never", fixedNow), "never");
    assert.equal(normalizeCreatedTaskDueDate("2026-05-22", fixedNow), "2026-05-22");
    assert.equal(normalizeCreatedTaskDueDate("2028-05-22", fixedNow), "2028-05-22");
  });
});

describe("RTMClient", () => {
  it("sends escaped filter queries when listing tasks", async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);
      return okResponse({
        tasks: {
          list: {
            id: "list-1",
            taskseries: {
              id: "series-1",
              name: "Draft plan",
              tags: { tag: ["work project"] },
              task: { id: "task-1", due: "2026-05-22T17:00:00Z", priority: "1" },
            },
          },
        },
      });
    };

    const tasks = await makeClient().listTasks({
      filter: "status:incomplete",
      dueDate: "next Tuesday",
      tag: "work project",
    });

    assert.equal(requests.length, 1);
    assert.equal(
      getParams(requests[0]).get("filter"),
      '(status:incomplete AND due:"next Tuesday" AND tag:"work project")'
    );
    assert.deepEqual(tasks, [
      {
        id: { list: "list-1", series: "series-1", task: "task-1" },
        name: "Draft plan",
        due: "2026-05-22T17:00:00Z",
        priority: 1,
        tags: ["work project"],
      },
    ]);
  });

  it("marks natural language meridiem due dates as having a due time", async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);

      if (requests.length === 1) {
        return okResponse({ timeline: "timeline-1" });
      }

      if (requests.length === 2) {
        return okResponse({
          list: {
            id: "list-1",
            taskseries: {
              id: "series-1",
              task: { id: "task-1" },
            },
          },
        });
      }

      return okResponse({});
    };

    await makeClient().addTask({
      name: "Draft plan",
      dueDate: "next Tuesday 5pm",
      mode: "explicit",
    });

    assert.equal(requests.length, 4);
    const dueDateParams = getParams(requests[2]);
    assert.equal(dueDateParams.get("method"), "rtm.tasks.setDueDate");
    assert.equal(dueDateParams.get("has_due_time"), "1");
    assert.equal(getParams(requests[3]).get("method"), "rtm.tasks.addTags");
    assert.equal(getParams(requests[3]).get("tags"), "AI");
  });

  it("adds the required AI tag through smart add", async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);

      if (requests.length === 1) {
        return okResponse({ timeline: "timeline-1" });
      }

      return okResponse({
        list: {
          id: "list-1",
          taskseries: {
            id: "series-1",
            task: { id: "task-1" },
          },
        },
      });
    };

    await makeClient().addTask({
      name: "Draft plan",
      tags: ["work"],
      mode: "smart",
    });

    assert.equal(requests.length, 2);
    assert.equal(getParams(requests[1]).get("method"), "rtm.tasks.add");
    assert.equal(getParams(requests[1]).get("name"), "Draft plan ^today #work #AI");
  });

  it("defaults missing smart add due dates to today", async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);

      if (requests.length === 1) {
        return okResponse({ timeline: "timeline-1" });
      }

      return okResponse({
        list: {
          id: "list-1",
          taskseries: {
            id: "series-1",
            task: { id: "task-1" },
          },
        },
      });
    };

    await makeClient().addTask({
      name: "Draft plan",
      mode: "smart",
    });

    assert.equal(requests.length, 2);
    assert.equal(getParams(requests[1]).get("method"), "rtm.tasks.add");
    assert.equal(getParams(requests[1]).get("name"), "Draft plan ^today #AI");
  });

  it("adds an optional note after smart add creates the task", async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);

      if (requests.length === 1) {
        return okResponse({ timeline: "timeline-1" });
      }

      if (requests.length === 2) {
        return okResponse({
          list: {
            id: "list-1",
            taskseries: {
              id: "series-1",
              task: { id: "task-1" },
            },
          },
        });
      }

      return okResponse({
        note: {
          id: "note-1",
          title: "AI Generated Note",
          $t: "Bring the Q2 numbers.",
        },
      });
    };

    await makeClient().addTask({
      name: "Draft plan",
      note: "Bring the Q2 numbers.",
      mode: "smart",
    });

    assert.equal(requests.length, 3);
    const noteParams = getParams(requests[2]);
    assert.equal(noteParams.get("method"), "rtm.tasks.notes.add");
    assert.equal(noteParams.get("list_id"), "list-1");
    assert.equal(noteParams.get("taskseries_id"), "series-1");
    assert.equal(noteParams.get("task_id"), "task-1");
    assert.equal(noteParams.get("timeline"), "timeline-1");
    assert.equal(noteParams.get("note_title"), "AI Generated Note");
    assert.equal(noteParams.get("note_text"), "Bring the Q2 numbers.");
  });

  it("adds the required AI tag through explicit add", async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);

      if (requests.length === 1) {
        return okResponse({ timeline: "timeline-1" });
      }

      if (requests.length === 2) {
        return okResponse({
          list: {
            id: "list-1",
            taskseries: {
              id: "series-1",
              task: { id: "task-1" },
            },
          },
        });
      }

      return okResponse({});
    };

    await makeClient().addTask({
      name: "Draft plan",
      tags: ["work"],
      mode: "explicit",
    });

    assert.equal(requests.length, 4);
    assert.equal(getParams(requests[2]).get("method"), "rtm.tasks.setDueDate");
    assert.equal(getParams(requests[2]).get("due"), "today");
    assert.equal(getParams(requests[3]).get("method"), "rtm.tasks.addTags");
    assert.equal(getParams(requests[3]).get("tags"), "work,AI");
  });

  it("uses today for out-of-range explicit add due dates", async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);

      if (requests.length === 1) {
        return okResponse({ timeline: "timeline-1" });
      }

      if (requests.length === 2) {
        return okResponse({
          list: {
            id: "list-1",
            taskseries: {
              id: "series-1",
              task: { id: "task-1" },
            },
          },
        });
      }

      return okResponse({});
    };

    await makeClient().addTask({
      name: "Draft plan",
      dueDate: "1900-01-01",
      mode: "explicit",
    });

    assert.equal(requests.length, 4);
    const dueDateParams = getParams(requests[2]);
    assert.equal(dueDateParams.get("method"), "rtm.tasks.setDueDate");
    assert.equal(dueDateParams.get("due"), "today");
  });

  it("adds an optional note after explicit add updates the task", async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);

      if (requests.length === 1) {
        return okResponse({ timeline: "timeline-1" });
      }

      if (requests.length === 2) {
        return okResponse({
          list: {
            id: "list-1",
            taskseries: {
              id: "series-1",
              task: { id: "task-1" },
            },
          },
        });
      }

      return okResponse({});
    };

    await makeClient().addTask({
      name: "Draft plan",
      note: "Bring the Q2 numbers.",
      mode: "explicit",
    });

    assert.equal(requests.length, 5);
    assert.equal(getParams(requests[2]).get("method"), "rtm.tasks.setDueDate");
    assert.equal(getParams(requests[3]).get("method"), "rtm.tasks.addTags");
    const noteParams = getParams(requests[4]);
    assert.equal(noteParams.get("method"), "rtm.tasks.notes.add");
    assert.equal(noteParams.get("list_id"), "list-1");
    assert.equal(noteParams.get("taskseries_id"), "series-1");
    assert.equal(noteParams.get("task_id"), "task-1");
    assert.equal(noteParams.get("timeline"), "timeline-1");
    assert.equal(noteParams.get("note_title"), "AI Generated Note");
    assert.equal(noteParams.get("note_text"), "Bring the Q2 numbers.");
  });

  it("returns the composite task id needed for follow-up edits", async () => {
    globalThis.fetch = async (url) => {
      if (getParams(url).get("method") === "rtm.timelines.create") {
        return okResponse({ timeline: "timeline-1" });
      }
      return okResponse({
        list: {
          id: "list-1",
          taskseries: {
            id: "series-1",
            task: { id: "task-1" },
          },
        },
      });
    };

    const result = await makeClient().addTask({ name: "Draft plan" });

    assert.deepEqual(result, {
      success: true,
      id: { list: "list-1", series: "series-1", task: "task-1" },
    });
  });

  it("updates every value supported by task creation", async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);
      return getParams(url).get("method") === "rtm.timelines.create"
        ? okResponse({ timeline: "timeline-1" })
        : okResponse({});
    };

    const result = await makeClient().updateTask({
      id: { list: "list-1", series: "series-1", task: "task-1" },
      name: "Final plan",
      dueDate: "next Tuesday 5pm",
      repeats: "every week",
      priority: 2,
      tags: ["work", "planning"],
    });

    assert.deepEqual(result, {
      success: true,
      id: { list: "list-1", series: "series-1", task: "task-1" },
      updated: ["name", "dueDate", "repeats", "priority", "tags"],
    });
    assert.deepEqual(
      requests.map((url) => getParams(url).get("method")),
      [
        "rtm.timelines.create",
        "rtm.tasks.setName",
        "rtm.tasks.setDueDate",
        "rtm.tasks.setRecurrence",
        "rtm.tasks.setPriority",
        "rtm.tasks.setTags",
      ]
    );

    for (const url of requests.slice(1)) {
      const params = getParams(url);
      assert.equal(params.get("list_id"), "list-1");
      assert.equal(params.get("taskseries_id"), "series-1");
      assert.equal(params.get("task_id"), "task-1");
      assert.equal(params.get("timeline"), "timeline-1");
    }
    assert.equal(getParams(requests[1]).get("name"), "Final plan");
    assert.equal(getParams(requests[2]).get("due"), "next Tuesday 5pm");
    assert.equal(getParams(requests[2]).get("has_due_time"), "1");
    assert.equal(getParams(requests[3]).get("repeat"), "every week");
    assert.equal(getParams(requests[4]).get("priority"), "2");
    assert.equal(getParams(requests[5]).get("tags"), "work,planning");
  });

  it("clears optional task values when explicitly requested", async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);
      return getParams(url).get("method") === "rtm.timelines.create"
        ? okResponse({ timeline: "timeline-1" })
        : okResponse({});
    };

    await makeClient().updateTask({
      id: { list: "list-1", series: "series-1", task: "task-1" },
      dueDate: "",
      repeats: "",
      priority: null,
      tags: [],
    });

    assert.equal(getParams(requests[1]).has("due"), false);
    assert.equal(getParams(requests[1]).has("has_due_time"), false);
    assert.equal(getParams(requests[2]).get("repeat"), "");
    assert.equal(getParams(requests[3]).get("priority"), "N");
    assert.equal(getParams(requests[4]).get("tags"), "");
  });

  it("rejects update calls with no values", async () => {
    await assert.rejects(
      makeClient().updateTask({
        id: { list: "list-1", series: "series-1", task: "task-1" },
      }),
      /At least one task value must be supplied/
    );
  });

  it("adds notes through the separate notes API and returns the note id", async () => {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);
      return getParams(url).get("method") === "rtm.timelines.create"
        ? okResponse({ timeline: "timeline-1" })
        : okResponse({ note: { id: "note-1" } });
    };

    const result = await makeClient().addTaskNote({
      id: { list: "list-1", series: "series-1", task: "task-1" },
      text: "Bring the Q2 numbers.",
    });

    const params = getParams(requests[1]);
    assert.equal(params.get("method"), "rtm.tasks.notes.add");
    assert.equal(params.get("list_id"), "list-1");
    assert.equal(params.get("taskseries_id"), "series-1");
    assert.equal(params.get("task_id"), "task-1");
    assert.equal(params.get("note_title"), "AI Generated Note");
    assert.equal(params.get("note_text"), "Bring the Q2 numbers.");
    assert.deepEqual(result, {
      success: true,
      id: "note-1",
      taskId: { list: "list-1", series: "series-1", task: "task-1" },
    });
  });
});
