/**
 * Interaction recipes: one click turns a cast into a working interaction chain.
 * Each recipe returns ready-to-insert EventDef objects, so the editor stays the
 * only writer of project data.
 */
import type { CanvasElement, EventDef, Step } from "./types";
import { makeStep } from "./defaults";
import { uid } from "./ids";

export type RecipeId =
  | "everyoneSpeaks"
  | "inOrder"
  | "randomCall"
  | "threeRound"
  | "allAtOnce";

export const RECIPE_LABELS: Record<RecipeId, string> = {
  everyoneSpeaks: "点谁谁说话",
  inOrder: "按顺序开麦",
  randomCall: "随机点名接梗",
  threeRound: "三轮对话",
  allAtOnce: "全员同时开口",
};

const charactersOf = (elements: CanvasElement[]) =>
  elements.filter((el) => el.type === "character" && (el.character?.voices.length ?? 0) > 0);

function event(name: string, triggerId: string, steps: Step[], nextEventId: string | null = null): EventDef {
  return { id: uid("ev"), name, triggerId, steps, nextEventId, enabled: true };
}

export function buildRecipes(recipe: RecipeId, elements: CanvasElement[]): EventDef[] {
  const cast = charactersOf(elements);
  if (cast.length === 0) return [];

  switch (recipe) {
    // 点谁谁说话：每个人物一个事件，播放自己的下一条语音
    case "everyoneSpeaks":
      return cast.map((el) =>
        event(
          `${el.character?.name ?? "人物"} 说话`,
          el.id,
          [{ ...makeStep("playAudio", el.id), parallel: false }],
        ),
      );

    // 按顺序开麦：点第一个人，依次触发后面的人
    case "inOrder": {
      const events = cast.map((el, index) =>
        event(
          `第 ${index + 1} 位 · ${el.character?.name ?? "人物"}`,
          el.id,
          [
            { ...makeStep("playAudio", el.id) },
            { ...makeStep("wait"), ms: 200 },
          ],
          null,
        ),
      );
      // wire the chain now that every id exists
      events.forEach((ev, index) => {
        if (index < events.length - 1) ev.nextEventId = events[index + 1].id;
      });
      return [events[0]];
    }

    // 随机点名：点任意人物 → 自己说话 → 随机另一个人接一句
    case "randomCall":
      return cast.map((el) => {
        const others = cast.filter((other) => other.id !== el.id);
        const steps: Step[] = [{ ...makeStep("playAudio", el.id) }];
        if (others.length > 0) {
          steps.push({ ...makeStep("wait"), ms: 120 });
          steps.push({ ...makeStep("playAudio", others[0].id), parallel: false });
          steps.push({ ...makeStep("animate", others[0].id), animation: "bounce" });
        }
        return event(`${el.character?.name ?? "人物"} 点名`, el.id, steps);
      });

    // 三轮对话：A → B → A，用 goto 串起来
    case "threeRound": {
      if (cast.length < 2) return [];
      const [a, b] = cast;
      const roundA = event(`A · ${a.character?.name ?? "甲"}`, a.id, [
        { ...makeStep("playAudio", a.id) },
        { ...makeStep("animate", a.id), animation: "nod" },
      ]);
      const roundB = event(`B · ${b.character?.name ?? "乙"}`, b.id, [
        { ...makeStep("playAudio", b.id) },
        { ...makeStep("animate", b.id), animation: "shake" },
      ]);
      const roundA2 = event(`A2 · ${a.character?.name ?? "甲"}`, a.id, [
        { ...makeStep("playAudio", a.id) },
        { ...makeStep("animate", a.id), animation: "jump" },
      ]);
      roundA.nextEventId = roundB.id;
      roundB.nextEventId = roundA2.id;
      return [roundA];
    }

    // 全员同时开口：点任一人，所有人同时播放下一条语音
    case "allAtOnce":
      return cast.map((trigger) =>
        event(
          `${trigger.character?.name ?? "人物"} 引爆全场`,
          trigger.id,
          cast.map((el) => ({ ...makeStep("playAudio", el.id), parallel: true })),
        ),
      );

    default:
      return [];
  }
}
