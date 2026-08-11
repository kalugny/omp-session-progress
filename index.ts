import { completeSimple } from "@oh-my-pi/pi-ai";
import type { ExtensionContext, ExtensionFactory } from "@oh-my-pi/pi-coding-agent";
import { formatSessionHistoryMarkdown } from "@oh-my-pi/pi-coding-agent/session/session-history-format";
import { Container, matchesKey, replaceTabs, Text } from "@oh-my-pi/pi-tui";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import summaryPrompt from "./summary-prompt.md" with { type: "text" };

const DEFAULT_INTERVAL_MS = 4 * 60_000;
const MAX_HISTORY_CHARS = 24_000;
const WIDGET_KEY = "session-progress";

const extension: ExtensionFactory = pi => {
	pi.registerFlag("session-progress-minutes", {
		description: "Minutes between session progress recaps (default: 4)",
		type: "string",
		default: "4",
	});

	let context: ExtensionContext | undefined;
	let active = false;
	let activity = "Waiting for the agent to start.";
	let activityVersion = 0;
	let summarizedVersion = -1;
	let running = false;
	let request: AbortController | undefined;
	let panelVisible = false;
	let stopListening: (() => void) | undefined;
	let previousSummary: string[] = [];

	function show(lines = previousSummary): void {
		const ctx = context;
		if (!ctx?.hasUI) return;
		if (lines.length === 0) {
			panelVisible = false;
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}

		ctx.ui.setWidget(
			WIDGET_KEY,
			(_tui, theme) => {
				const panel = new Container();
				const border = {
					render: (width: number) => [theme.fg("dim", "─".repeat(Math.max(1, width)))],
				};
				panel.addChild(border);
				panel.addChild(
					new Text(
						`${theme.bold(theme.fg("accent", "Session progress"))}${theme.fg("muted", " · Esc close")}`,
						1,
						0,
					),
				);
				for (const line of lines) panel.addChild(new Text(theme.fg("muted", line), 1, 0));
				panel.addChild(border);
				return panel;
			},
			{ placement: "aboveEditor" },
		);
		panelVisible = true;
	}

	function touch(nextActivity: string): void {
		activity = nextActivity;
		activityVersion++;
	}

	async function summarize(): Promise<void> {
		const ctx = context;
		if (!ctx?.hasUI || !active || running || activityVersion === summarizedVersion) return;

		const model = ctx.models.resolve("@smol") ?? ctx.model;
		const sessionId = ctx.sessionManager.getSessionId();
		if (!model || !sessionId) return;

		const messages = pi.pi.buildSessionContext(ctx.sessionManager.getBranch()).messages;
		if (messages.length === 0) return;

		const transcript = formatSessionHistoryMarkdown(messages);
		const recentTranscript = transcript.slice(-MAX_HISTORY_CHARS);
		const version = activityVersion;
		const abort = new AbortController();
		request = abort;
		running = true;

		try {
			const result = await completeSimple(
				model,
				{
					systemPrompt: [summaryPrompt],
					messages: [
						{
							role: "user",
							content: [
								`Session title: ${ctx.sessionManager.getSessionName() ?? "Untitled session"}`,
								`Current activity: ${activity}`,
								previousSummary.length > 0 ? `Previous summary:\n${previousSummary.join("\n")}` : "",
								`Recent transcript data:\n${recentTranscript}`,
							]
								.filter(Boolean)
								.join("\n\n"),
							timestamp: Date.now(),
						},
					],
				},
				{
					apiKey: ctx.modelRegistry.resolver(model, sessionId),
					cwd: ctx.cwd,
					disableReasoning: true,
					hideThinkingSummary: true,
					maxTokens: 160,
					sessionId: `${sessionId}:session-progress`,
					signal: abort.signal,
					statefulResponses: false,
				},
			);

			if (ctx.sessionManager.getSessionId() !== sessionId || abort.signal.aborted) return;
			const lines = replaceTabs(
				sanitizeText(result.content.filter(block => block.type === "text").map(block => block.text).join("\n")),
			)
				.split("\n")
				.map(line => line.trim())
				.filter(Boolean)
				.slice(0, 3);
			if (lines.length === 0) return;

			previousSummary = lines;
			summarizedVersion = version;
			show();
		} catch (error) {
			if (!abort.signal.aborted) pi.logger.debug("Session progress summary failed", { error: String(error) });
		} finally {
			if (request === abort) request = undefined;
			running = false;
		}
	}

	function reset(ctx: ExtensionContext): void {
		request?.abort();
		stopListening?.();
		stopListening = ctx.hasUI
			? ctx.ui.onTerminalInput(data => {
					if (!panelVisible || !matchesKey(data, "escape")) return;
					panelVisible = false;
					ctx.ui.setWidget(WIDGET_KEY, undefined);
					return { consume: true };
				})
			: undefined;
		context = ctx;
		active = false;
		activity = "Waiting for the agent to start.";
		activityVersion = 0;
		summarizedVersion = -1;
		previousSummary = [];
		show();
	}

	pi.on("session_start", (_event, ctx) => {
		reset(ctx);
		const configuredMinutes = Number(pi.getFlag("session-progress-minutes"));
		const intervalMs =
			Number.isFinite(configuredMinutes) && configuredMinutes > 0
				? configuredMinutes * 60_000
				: DEFAULT_INTERVAL_MS;
		if (intervalMs === DEFAULT_INTERVAL_MS && configuredMinutes !== 4) {
			ctx.ui.notify("Invalid --session-progress-minutes; using 4 minutes.", "warning");
		}
		ctx.setInterval(() => summarize(), intervalMs);
	});
	pi.on("session_switch", (_event, ctx) => reset(ctx));
	pi.on("session_branch", (_event, ctx) => reset(ctx));
	pi.on("session_tree", (_event, ctx) => reset(ctx));
	pi.on("before_agent_start", (_event, ctx) => {
		request?.abort();
		context = ctx;
		summarizedVersion = -1;
		previousSummary = [];
		show();
	});
	pi.on("agent_start", (_event, ctx) => {
		context = ctx;
		active = true;
		touch("The agent is working.");
	});
	pi.on("agent_end", () => {
		active = false;
		touch("The agent turn completed.");
	});
	pi.on("message_update", () => touch("The agent is responding."));
	pi.on("message_end", () => touch("The agent completed a message."));
	pi.on("tool_execution_start", event => touch(`Running ${event.toolName}.`));
	pi.on("tool_execution_update", event => touch(`Running ${event.toolName}.`));
	pi.on("tool_execution_end", event => touch(`${event.toolName} ${event.isError ? "failed" : "completed"}.`));
	pi.on("session_shutdown", (_event, ctx) => {
		request?.abort();
		panelVisible = false;
		stopListening?.();
		stopListening = undefined;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	});
};

export default extension;
