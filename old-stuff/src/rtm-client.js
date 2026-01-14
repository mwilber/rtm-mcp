// rtm-client.js
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

	// ---------- Low-level helpers ----------

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
	return rsp.timeline; // string
	}

	// Extract the first task path from any response with tasks
	#extractTaskPath(rsp) {
	// Try both possible roots: rsp.tasks.list and rsp.list
	const collectLists = (root) => {
		const node = root?.list;
		if (!node) return [];
		return Array.isArray(node) ? node : [node];
	};

	let lists = [];
	if (rsp?.tasks) lists = collectLists(rsp.tasks);
	if (lists.length === 0 && rsp?.list) lists = collectLists(rsp); // fallback

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


	// ---------- Public: listTasks ----------

	/**
	 * List tasks filtered by due date (single date or {start, end}) and/or a tag.
	 * @param {Object} params
	 * @param {string|{start?:string,end?:string}} [params.dueDate]  // "YYYY-MM-DD" or partial range
	 * @param {string} [params.tag]
	 * @returns {Promise<Array<{id:{list:string,series:string,task:string}, name:string, due:string|null, priority:1|2|3|null, tags:string[] }>>}
	 */
	async listTasks({ dueDate, tag } = {}) {
	const filterParts = [];

	// Date filter
	if (typeof dueDate === "string") {
		filterParts.push(`due:${dueDate}`);
	} else if (dueDate && typeof dueDate === "object" && (dueDate.start || dueDate.end)) {
		if (dueDate.start) filterParts.push(`dueAfter:${dueDate.start}`);
		if (dueDate.end) filterParts.push(`dueBefore:${dueDate.end}`);
	}

	// Tag filter
	if (tag) {
		// tags are simple words, RTM filter uses tag:NAME
		filterParts.push(`tag:${tag}`);
	}

	const filter =
		filterParts.length === 0
		? undefined
		: filterParts.length === 1
		? filterParts[0]
		: "(" + filterParts.join(" AND ") + ")";

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

	// ---------- Public: addTask ----------

	/**
	 * Add a task (Smart Add single call, or explicit multi-call).
	 * @param {Object} params
	 * @param {string} params.name
	 * @param {string} [params.dueDate]   // e.g., "2025-10-31 17:00" (Smart Add or setDueDate with parse=1)
	 * @param {string} [params.repeats]   // e.g., "every week", "after 2 days"
	 * @param {1|2|3}  [params.priority]  // 1 (highest), 2, 3; omit for none
	 * @param {string[]} [params.tags]    // ["marketing","q4"]
	 * @param {"smart"|"explicit"} [params.mode="smart"]
	 * @returns {Promise<{success:true, id:{list:string,series:string,task:string}}>}
	 */
	async addTask({ name, dueDate, repeats, priority, tags, mode = "smart" }) {
	if (!name) throw new Error("name is required");

	const timeline = await this.#createTimeline();

	if (mode === "smart") {
		// Build Smart Add string
		const bits = [name];
		if (dueDate) bits.push("^" + dueDate);
		if (repeats) bits.push("*" + repeats);
		if (priority) bits.push("!" + priority);
		if (Array.isArray(tags) && tags.length) bits.push(tags.map((t) => "#" + t).join(" "));

		const rsp = await this.#request("rtm.tasks.add", {
		name: bits.join(" "),
		parse: 1,
		timeline,
		});

		// TEMP: peek at the raw response
		// console.dir(rsp, { depth: null });

		const path = this.#extractTaskPath(rsp);
		if (!path) throw new Error("Could not parse task path from add response");
		return { success: true, id: { list: path.list_id, series: path.taskseries_id, task: path.task_id } };
	}

	// Explicit: multiple calls
	// 1) Add
	const addRsp = await this.#request("rtm.tasks.add", { name, timeline });
	const path = this.#extractTaskPath(addRsp);
	if (!path) throw new Error("Could not parse task path from add response");

	const basePath = {
		list_id: path.list_id,
		taskseries_id: path.taskseries_id,
		task_id: path.task_id,
		timeline,
	};

	// 2) Due date
	if (dueDate) {
		await this.#request("rtm.tasks.setDueDate", {
		...basePath,
		due: dueDate,
		parse: 1, // allow natural language, or exact ISO
		has_due_time: /\d{1,2}:\d{2}/.test(dueDate) ? 1 : 0,
		});
	}

	// 3) Recurrence
	if (repeats) {
		await this.#request("rtm.tasks.setRecurrence", {
		...basePath,
		repeat: repeats, // e.g., "every week", "after 2 days"
		});
	}

	// 4) Priority
	if (priority) {
		await this.#request("rtm.tasks.setPriority", {
		...basePath,
		priority: String(priority), // "1" | "2" | "3"
		});
	}

	// 5) Tags
	if (Array.isArray(tags) && tags.length) {
		await this.#request("rtm.tasks.addTags", {
		...basePath,
		tags: tags.join(","), // comma-separated
		});
	}

	return { success: true, id: { list: path.list_id, series: path.taskseries_id, task: path.task_id } };
	}
}
