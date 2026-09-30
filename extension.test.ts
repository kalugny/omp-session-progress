import { expect, test, mock } from "bun:test";

const completeCalls: unknown[][] = [];
const historyCalls: unknown[][] = [];

mock.module("@oh-my-pi/pi-ai", () => ({
	completeSimple: async (...args: unknown[]) => {
		completeCalls.push(args);
		return { content: [{ type: "text", text: `Summary ${completeCalls.length}` }] };
	},
}));

mock.module("@oh-my-pi/pi-coding-agent/session/session-history-format", () => ({
	formatSessionHistoryMarkdown: (messages: unknown[]) => {
		historyCalls.push(messages);
		return "mock transcript";
	},
}));

class Container {
	children: unknown[] = [];

	addChild(child: unknown): void {
		this.children.push(child);
	}
}

class Text {
	text: string;
	setTextCalls = 0;

	constructor(text: string) {
		this.text = text;
	}

	setText(text: string): void {
		this.text = text;
		this.setTextCalls++;
	}
}

mock.module("@oh-my-pi/pi-tui", () => ({
	Container,
	Text,
	matchesKey: () => false,
	replaceTabs: (text: string) => text,
}));
mock.module("@oh-my-pi/pi-utils", () => ({ sanitizeText: (text: string) => text }));

// Static import cannot run before mock.module; this dynamic import crosses the mocked module boundary.
const { default: extension } = await import("./index.ts");

type Handler = (...args: unknown[]) => unknown;
type Timer = { callback: () => unknown; delay: number };

function harness(hasUI: boolean) {
	const handlers = new Map<string, Handler>();
	const timers: Timer[] = [];
	const widgets: { key: string; widget: unknown; options: unknown }[] = [];
	let renderCalls = 0;
	const sessionManager = {
		getSessionId: () => "session-1",
		getSessionName: () => "Test session",
		getBranch: () => [],
	};
	const context = {
		hasUI,
		cwd: "/tmp",
		model: { id: "model" },
		models: { resolve: () => ({ id: "smol" }) },
		modelRegistry: { resolver: () => "api-key" },
		sessionManager,
		ui: {
			setWidget: (key: string, widget: unknown, options: unknown) => widgets.push({ key, widget, options }),
			onTerminalInput: () => () => { },
			notify: () => { },
			requestRender: () => renderCalls++,
		},
		setInterval: (callback: () => unknown, delay: number) => {
			timers.push({ callback, delay });
			return timers.length;
		},
	};
	const pi = {
		registerFlag: () => { },
		getFlag: () => "1",
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		logger: { debug: () => { } },
		pi: { buildSessionContext: () => ({ messages: [{ role: "user", content: "work" }] }) },
	};
	extension(pi as unknown as Parameters<typeof extension>[0]);
	return {
		context,
		timers,
		widgets,
		renderCalls: () => renderCalls,
		requestRender: () => renderCalls++,
		emit: async (event: string, ...args: unknown[]) => await handlers.get(event)?.(...args),
	};
}

test("recaps only on recap ticks and refreshes an existing widget", async () => {
	completeCalls.length = 0;
	historyCalls.length = 0;
	const app = harness(true);
	await app.emit("session_start", {}, app.context);
	await app.emit("agent_start", {}, app.context);

	const recap = app.timers.find(timer => timer.delay === 60_000);
	const timestamp = app.timers.find(timer => timer.delay === 10_000);
	expect(recap).toBeDefined();
	expect(timestamp).toBeDefined();

	await recap?.callback();
	expect(completeCalls).toHaveLength(1);
	expect(historyCalls).toHaveLength(1);
	const visibleWidgets = () => app.widgets.filter(({ widget }) => typeof widget === "function");
	expect(visibleWidgets()).toHaveLength(1);
	const panel = (visibleWidgets()[0].widget as (tui: unknown, theme: unknown) => Container)(
		{ requestRender: () => app.requestRender() },
		{ bold: (text: string) => text, fg: (_color: string, text: string) => text },
	);
	const title = panel.children.find((child): child is Text => child instanceof Text);
	expect(title).toBeDefined();
	expect(panel.children.some(child => child instanceof Text && child.text.includes("Summary 1"))).toBe(true);

	const tool = { toolName: "shell", isError: false };
	await app.emit("tool_execution_start", tool);
	await app.emit("tool_execution_update", tool);
	await app.emit("tool_execution_update", tool);
	await app.emit("tool_execution_end", tool);
	await timestamp?.callback();
	await timestamp?.callback();
	await app.emit("message_update");
	expect(completeCalls).toHaveLength(1);
	expect(visibleWidgets()).toHaveLength(1);
	expect(title?.setTextCalls).toBeGreaterThan(0);
	expect(app.renderCalls()).toBeGreaterThan(0);

	await recap?.callback();
	expect(completeCalls).toHaveLength(2);
});

test("headless sessions schedule no recap timers or summaries", async () => {
	completeCalls.length = 0;
	const app = harness(false);
	await app.emit("session_start", {}, app.context);
	await app.emit("agent_start", {}, app.context);
	for (const timer of app.timers) await timer.callback();
	expect(app.timers).toHaveLength(0);
	expect(completeCalls).toHaveLength(0);
});
