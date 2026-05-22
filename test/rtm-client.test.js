import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildTaskFilter,
  ensureCreatedTaskTags,
  hasDueTime,
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
    assert.equal(getParams(requests[1]).get("name"), "Draft plan #work #AI");
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

    assert.equal(requests.length, 3);
    assert.equal(getParams(requests[2]).get("method"), "rtm.tasks.addTags");
    assert.equal(getParams(requests[2]).get("tags"), "work,AI");
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

    assert.equal(requests.length, 4);
    assert.equal(getParams(requests[2]).get("method"), "rtm.tasks.addTags");
    const noteParams = getParams(requests[3]);
    assert.equal(noteParams.get("method"), "rtm.tasks.notes.add");
    assert.equal(noteParams.get("list_id"), "list-1");
    assert.equal(noteParams.get("taskseries_id"), "series-1");
    assert.equal(noteParams.get("task_id"), "task-1");
    assert.equal(noteParams.get("timeline"), "timeline-1");
    assert.equal(noteParams.get("note_title"), "AI Generated Note");
    assert.equal(noteParams.get("note_text"), "Bring the Q2 numbers.");
  });
});
