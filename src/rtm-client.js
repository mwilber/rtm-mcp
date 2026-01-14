import crypto from "node:crypto";

export class RTMClient {
  constructor({
    apiKey,
    sharedSecret,
    authToken,
    baseUrl = "https://api.rememberthemilk.com/services/rest/",
  }) {
    if (!apiKey || !sharedSecret || !authToken) {
      throw new Error("apiKey, sharedSecret, and authToken are required");
    }
    this.apiKey = apiKey;
    this.sharedSecret = sharedSecret;
    this.authToken = authToken;
    this.baseUrl = baseUrl;
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

  async listTasks({ dueDate, tag } = {}) {
    const filterParts = [];

    if (typeof dueDate === "string") {
      filterParts.push(`due:${dueDate}`);
    } else if (dueDate && typeof dueDate === "object" && (dueDate.start || dueDate.end)) {
      if (dueDate.start) filterParts.push(`dueAfter:${dueDate.start}`);
      if (dueDate.end) filterParts.push(`dueBefore:${dueDate.end}`);
    }

    if (tag) {
      filterParts.push(`tag:${tag}`);
    }

    const filter =
      filterParts.length === 0
        ? undefined
        : filterParts.length === 1
        ? filterParts[0]
        : `(${filterParts.join(" AND ")})`;

    const rsp = await this.#request("rtm.tasks.getList", filter ? { filter } : {});
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

  async addTask({ name, dueDate, repeats, priority, tags, mode = "smart" }) {
    if (!name) throw new Error("name is required");

    const timeline = await this.#createTimeline();

    if (mode === "smart") {
      const bits = [name];
      if (dueDate) bits.push("^" + dueDate);
      if (repeats) bits.push("*" + repeats);
      if (priority) bits.push("!" + priority);
      if (Array.isArray(tags) && tags.length) {
        bits.push(tags.map((tag) => "#" + tag).join(" "));
      }

      const rsp = await this.#request("rtm.tasks.add", {
        name: bits.join(" "),
        parse: 1,
        timeline,
      });

      const path = this.#extractTaskPath(rsp);
      if (!path) throw new Error("Could not parse task path from add response");
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
        has_due_time: /\d{1,2}:\d{2}/.test(dueDate) ? 1 : 0,
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

    if (Array.isArray(tags) && tags.length) {
      await this.#request("rtm.tasks.addTags", {
        ...basePath,
        tags: tags.join(","),
      });
    }

    return {
      success: true,
      id: { list: path.list_id, series: path.taskseries_id, task: path.task_id },
    };
  }
}
