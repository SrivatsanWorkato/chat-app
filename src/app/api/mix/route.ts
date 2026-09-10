import { FALLBACK_MODELS, MixPlan, MODELS } from "@/lib/chat";
import { completeWithFallback, generateImage } from "@/lib/openrouter";

const PLANNER_PROMPT = `You plan a creative workflow. Create 2-6 tasks. Use brain for strategy, naming, positioning, and briefs; blitz for short copy and slogans; image only for explicitly requested images. At most one image task. Dependencies must reference earlier tasks. Do not put model names, URLs, tools, or secrets in the plan.`;
const PLAN_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "mix_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["goal", "tasks"],
      properties: {
        goal: { type: "string", minLength: 1, maxLength: 500 },
        tasks: {
          type: "array", minItems: 2, maxItems: 6,
          items: {
            type: "object", additionalProperties: false,
            required: ["id", "title", "capability", "instruction", "dependsOn"],
            properties: {
              id: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
              title: { type: "string", maxLength: 120 },
              capability: { type: "string", enum: ["brain", "blitz", "image"] },
              instruction: { type: "string", maxLength: 1000 },
              dependsOn: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
  },
};

function planError(value: unknown): string | null {
  if (!value || typeof value !== "object") return "plan must be an object";
  const plan = value as Partial<MixPlan>;
  if (typeof plan.goal !== "string" || !plan.goal.trim() || plan.goal.length > 500) return "goal must be 1-500 characters";
  if (!Array.isArray(plan.tasks) || plan.tasks.length < 2 || plan.tasks.length > 6) return "plan must contain 2-6 tasks";
  const ids = new Set<string>();
  let imageTasks = 0;
  for (const [index, task] of plan.tasks.entries()) {
    if (!task || typeof task.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(task.id)) return `task ${index + 1} has an invalid id`;
    if (ids.has(task.id)) return `task ${index + 1} duplicates id ${task.id}`;
    if (typeof task.title !== "string" || !task.title || task.title.length > 120) return `task ${task.id} has an invalid title`;
    if (typeof task.instruction !== "string" || !task.instruction || task.instruction.length > 1000) return `task ${task.id} has an invalid instruction`;
    if (!["brain", "blitz", "image"].includes(task.capability)) return `task ${task.id} has an unsupported capability`;
    if (!Array.isArray(task.dependsOn) || !task.dependsOn.every((id) => ids.has(id))) return `task ${task.id} has a missing or forward dependency`;
    ids.add(task.id);
    if (task.capability === "image") imageTasks += 1;
  }
  return imageTasks > 1 ? "plan contains more than one image task" : null;
}

function event(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}

async function createPlan(prompt: string) {
  let correction = "";
  let lastError = "unknown validation error";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const planned = await completeWithFallback("router", [MODELS.brain, ...FALLBACK_MODELS.brain], [{ role: "user", content: `${PLANNER_PROMPT}\n${correction}\nUser goal:\n${prompt}` }], { maxTokens: 1_000, responseFormat: PLAN_SCHEMA, timeoutMs: 20_000 });
    try {
      const parsed = JSON.parse(planned.content.replace(/^```json\s*|\s*```$/g, ""));
      const error = planError(parsed);
      if (!error) return parsed as MixPlan;
      lastError = error;
    } catch (error) {
      lastError = error instanceof SyntaxError ? `malformed JSON: ${error.message}` : "unable to parse plan";
    }
    console.error("[mix] invalid plan", { attempt: attempt + 1, error: lastError, contentLength: planned.content.length });
    correction = `Your previous plan was rejected: ${lastError}. Return a corrected plan matching the schema.`;
  }
  throw new Error(`Mix plan validation failed: ${lastError}`);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { prompt?: unknown; plan?: unknown; approveImageTaskId?: unknown };
    if (typeof body.prompt !== "string" || body.prompt.length < 1 || body.prompt.length > 20_000) return Response.json({ error: "Invalid Mix request" }, { status: 400 });
    let plan: MixPlan;
    if (body.plan !== undefined) {
      const error = planError(body.plan);
      if (error) return Response.json({ error: `Invalid Mix plan: ${error}` }, { status: 400 });
      plan = body.plan as MixPlan;
    } else {
      try { plan = await createPlan(body.prompt); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Mix could not create a safe execution plan" }, { status: 502 }); }
    }

    const approvedTask = typeof body.approveImageTaskId === "string" ? body.approveImageTaskId : undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(event({ type: "mix_plan", plan })));
        const outputs = new Map<string, string>();
        for (const task of plan.tasks) {
          if (task.capability === "image" && task.id !== approvedTask) {
            controller.enqueue(encoder.encode(event({ type: "mix_approval", taskId: task.id, estimatedCost: 0.019 })));
            continue;
          }
          const dependencyContext = task.dependsOn.map((id) => `${id}: ${outputs.get(id) ?? "Not completed"}`).join("\n\n");
          const model = MODELS[task.capability];
          controller.enqueue(encoder.encode(event({ type: "mix_task_started", taskId: task.id, model })));
          try {
            if (task.capability === "image") {
              const image = await generateImage(MODELS.image, `${task.instruction}\n\nContext:\n${dependencyContext}`);
              outputs.set(task.id, "Image generated");
              controller.enqueue(encoder.encode(event({ type: "mix_task_completed", taskId: task.id, output: "Image generated", image: { dataUrl: image.dataUrl, model: MODELS.image } })));
              continue;
            }
            const result = await completeWithFallback("response", [MODELS[task.capability], ...FALLBACK_MODELS[task.capability]], [{ role: "user", content: `Complete this task only.\nTask: ${task.instruction}\nOriginal goal: ${body.prompt}\nDependency outputs:\n${dependencyContext || "None"}\nReturn concise Markdown.` }], { maxTokens: 600, timeoutMs: 20_000 });
            outputs.set(task.id, result.content);
            controller.enqueue(encoder.encode(event({ type: "mix_task_delta", taskId: task.id, content: result.content })));
            controller.enqueue(encoder.encode(event({ type: "mix_task_completed", taskId: task.id, output: result.content, model: result.model })));
          } catch (error) {
            controller.enqueue(encoder.encode(event({ type: "mix_task_failed", taskId: task.id, error: error instanceof Error ? error.message : "Task failed" })));
          }
        }
        controller.enqueue(encoder.encode(event({ type: "mix_completed" })));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to process Mix request" }, { status: 500 });
  }
}
