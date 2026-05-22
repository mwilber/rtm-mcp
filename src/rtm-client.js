import crypto from "node:crypto";

const SIMPLE_FILTER_VALUE = /^[A-Za-z0-9_.:-]+$/;
const DUE_TIME_PATTERN = /\b(?:\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm))\b/i;
const REQUIRED_CREATED_TASK_TAG = "AI";
const AI_NOTE_TITLE = "AI Generated Note";

export function quoteFilterValue(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error("Filter values must be non-empty strings");
  }

  if (SIMPLE_FILTER_VALUE.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function hasDueTime(value) {
  return DUE_TIME_PATTERN.test(String(value ?? ""));
}

export function buildTaskFilter({ dueDate, tag, filter } = {}) {
  const filterParts = [];

  if (filter) {
    filterParts.push(filter);
  }

  if (typeof dueDate === "string") {
    filterParts.push(`due:${quoteFilterValue(dueDate)}`);
  } else if (
    dueDate &&
    typeof dueDate === "object" &&
    (dueDate.start || dueDate.end)
  ) {
    if (dueDate.start) {
      filterParts.push(`dueAfter:${quoteFilterValue(dueDate.start)}`);
    }
    if (dueDate.end) {
      filterParts.push(`dueBefore:${quoteFilterValue(dueDate.end)}`);
    }
  }

  if (tag) {
    filterParts.push(`tag:${quoteFilterValue(tag)}`);
  }

  if (filterParts.length === 0) {
    return undefined;
  }

  return filterParts.length === 1
    ? filterParts[0]
    : `(${filterParts.join(" AND ")})`;
}

export function ensureCreatedTaskTags(tags) {
  const normalizedTags = Array.isArray(tags)
    ? tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];

  if (!normalizedTags.includes(REQUIRED_CREATED_TASK_TAG)) {
    normalizedTags.push(REQUIRED_CREATED_TASK_TAG);
  }

  return normalizedTags;
}

export class RTMClient {
  constructor({
    apiKey,
    sharedSecret,
    authToken,
    baseUrl = "https://api.rememberthemilk.com/services/rest/",
    debug = false,
  }) {
    if (!apiKey || !sharedSecret || !authToken) {
      throw new Error("apiKey, sharedSecret, and authToken are required");
    }
    this.apiKey = apiKey;
    this.sharedSecret = sharedSecret;
    this.authToken = authToken;
    this.baseUrl = baseUrl;
    this.debug = debug;
  }

  #signParams(params) {
    const keys = Object.keys(params).sort();
    const base = this.sharedSecret + keys.map((k) => k + params[k]).join("");
    return crypto.createHash("md5").update(base).digest("hex");
  }

  async #request(methodName, params = {}, { requireAuth = true } = {}) {
    const p = {
      api_key: this.apiKey,
      method: methodName,
      format: "json",
      ...(requireAuth ? { auth_token: this.authToken } : {}),
      ...params,
    };
    p.api_sig = this.#signParams(p);

    const url = this.baseUrl + "?" + new URLSearchParams(p).toString();
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
    }
    const data = await res.json();

    if (!data?.rsp) throw new Error("Malformed API response");
    if (data.rsp.stat !== "ok") {
      const err = data.rsp.err || {};
      throw new Error(`RTM error ${err.code ?? ""}: ${err.msg ?? "Unknown"}`);
    }
    if (this.debug) {
      const pretty = JSON.stringify(data.rsp, null, 2);
      console.log(`[rtm-mcp] RTM response for ${methodName}:\n${pretty}`);
    }
    return data.rsp;
  }

  async #createTimeline() {
    const rsp = await this.#request("rtm.timelines.create");
    return rsp.timeline;
  }

  #extractTaskPath(rsp) {
    const collectLists = (root) => {
      const node = root?.list;
      if (!node) return [];
      return Array.isArray(node) ? node : [node];
    };

    let lists = [];
    if (rsp?.tasks) lists = collectLists(rsp.tasks);
    if (lists.length === 0 && rsp?.list) lists = collectLists(rsp);

    for (const li of lists) {
      const series = li?.taskseries;
      const seriesArr = Array.isArray(series) ? series : series ? [series] : [];
      for (const ts of seriesArr) {
        const tnode = ts?.task;
        const taskArr = Array.isArray(tnode) ? tnode : tnode ? [tnode] : [];
        for (const t of taskArr) {
          if (li?.id && ts?.id && t?.id) {
            return { list_id: li.id, taskseries_id: ts.id, task_id: t.id };
          }
        }
      }
    }
    return null;
  }

  async listTasks({ dueDate, tag, filter } = {}) {
    const filterQuery = buildTaskFilter({ dueDate, tag, filter });

    const rsp = await this.#request(
      "rtm.tasks.getList",
      filterQuery ? { filter: filterQuery } : {}
    );
    const results = [];

    const lists = rsp?.tasks?.list;
    const listArr = Array.isArray(lists) ? lists : lists ? [lists] : [];

    for (const li of listArr) {
      const taskseriesArr = Array.isArray(li.taskseries)
        ? li.taskseries
        : li.taskseries
        ? [li.taskseries]
        : [];
      for (const ts of taskseriesArr) {
        const taskArr = Array.isArray(ts.task) ? ts.task : ts.task ? [ts.task] : [];
        for (const t of taskArr) {
          const tagsNode = ts.tags;
          let tagList = [];
          if (tagsNode && tagsNode.tag) {
            tagList = Array.isArray(tagsNode.tag) ? tagsNode.tag : [tagsNode.tag];
          }
          let priority = null;
          if (t.priority && t.priority !== "N") {
            const parsedPriority = Number(t.priority);
            if ([1, 2, 3].includes(parsedPriority)) {
              priority = parsedPriority;
            }
          }

          results.push({
            id: { list: li.id, series: ts.id, task: t.id },
            name: ts.name,
            due: t.due || null,
            priority,
            tags: tagList,
          });
        }
      }
    }

    return results;
  }

  async addTask({ name, dueDate, repeats, priority, tags, note, mode = "smart" }) {
    if (!name) throw new Error("name is required");

    const timeline = await this.#createTimeline();
    const taskTags = ensureCreatedTaskTags(tags);

    if (mode === "smart") {
      const bits = [name];
      if (dueDate) bits.push("^" + dueDate);
      if (repeats) bits.push("*" + repeats);
      if (priority) bits.push("!" + priority);
      bits.push(taskTags.map((tag) => "#" + tag).join(" "));

      const rsp = await this.#request("rtm.tasks.add", {
        name: bits.join(" "),
        parse: 1,
        timeline,
      });

      const path = this.#extractTaskPath(rsp);
      if (!path) throw new Error("Could not parse task path from add response");
      await this.#addNote({ path, timeline, note });
      return {
        success: true,
        id: { list: path.list_id, series: path.taskseries_id, task: path.task_id },
      };
    }

    const addRsp = await this.#request("rtm.tasks.add", { name, timeline });
    const path = this.#extractTaskPath(addRsp);
    if (!path) throw new Error("Could not parse task path from add response");

    const basePath = {
      list_id: path.list_id,
      taskseries_id: path.taskseries_id,
      task_id: path.task_id,
      timeline,
    };

    if (dueDate) {
      await this.#request("rtm.tasks.setDueDate", {
        ...basePath,
        due: dueDate,
        parse: 1,
        has_due_time: hasDueTime(dueDate) ? 1 : 0,
      });
    }

    if (repeats) {
      await this.#request("rtm.tasks.setRecurrence", {
        ...basePath,
        repeat: repeats,
      });
    }

    if (priority) {
      await this.#request("rtm.tasks.setPriority", {
        ...basePath,
        priority: String(priority),
      });
    }

    await this.#request("rtm.tasks.addTags", {
      ...basePath,
      tags: taskTags.join(","),
    });

    await this.#addNote({ path, timeline, note });

    return {
      success: true,
      id: { list: path.list_id, series: path.taskseries_id, task: path.task_id },
    };
  }

  async #addNote({ path, timeline, note }) {
    const noteText = String(note ?? "").trim();
    if (!noteText) {
      return;
    }

    await this.#request("rtm.tasks.notes.add", {
      list_id: path.list_id,
      taskseries_id: path.taskseries_id,
      task_id: path.task_id,
      timeline,
      note_title: AI_NOTE_TITLE,
      note_text: noteText,
    });
  }

  async setDueDate({ listId, taskseriesId, taskId, dueDate }) {
    if (!listId || !taskseriesId || !taskId) {
      throw new Error("listId, taskseriesId, and taskId are required");
    }

    const timeline = await this.#createTimeline();
    await this.#request("rtm.tasks.setDueDate", {
      list_id: listId,
      taskseries_id: taskseriesId,
      task_id: taskId,
      timeline,
      due: dueDate || "",
      parse: 1,
      has_due_time: hasDueTime(dueDate) ? 1 : 0,
    });

    return { success: true };
  }
}
