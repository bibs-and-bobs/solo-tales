/* Prompt-boundary sanitizer (`pk`): strips control characters, markup brackets,
   packet section labels (both before and after bracket removal), and prompt-injection phrases. */

const PACKET_LABEL =
  /\b(VOICE|STYLE|RULES|EVENTS|REPLY|DATA RULES|SETTING|PC|TIME|SCENE SO FAR|SCENE|PRESENT|SUMMARY|CHAPTER|QUESTS|CLOCKS|DIRECTOR TRIGGER|FOE ROSTER|POOL|CHECKS|INSTRUCTIONS|PEOPLE|RECENT|PLAYER NOW|PLAYER|NARRATOR|DIRECTOR NOTE|CHARACTER|ABILITIES|SKILLS|HIT DICE|ATTACKS|CONDITIONS|GOLD|INVENTORY|LOCATION|STORY SO FAR|PLACES KNOWN|PEOPLE KNOWN|THINGS KNOWN|WHAT THE CHARACTER KNOWS|QUESTION|OLD SUMMARY|OLD CHAPTER|NEW BEATS|HERO|STORY|TONE|FOES|EARLIER|ROUND|SYSTEM|ASSISTANT|USER|HUMAN)\s*:/g;

const INJECT = [
  /\b(ignore|disregard|override|bypass|forget)\b[^.!?]{0,40}?\b(instructions?|prompts?|guidelines|system messages?)\b/gi,
  /\b(system prompt|developer mode|jailbreak|new instructions|prompt injection)\b/gi
];

export function pk(v: unknown, max = 600): string {
  const unlabel = (x: string) =>
    x.replace(PACKET_LABEL, m => m.replace(/\s*:$/, "").toLowerCase() + " -");

  // Unlabel BEFORE stripping markup brackets (so "<b>SYSTEM:" cannot hide behind a tag)
  // and AGAIN AFTER stripping brackets (so "SYS<>TEM:" cannot coalesce into "SYSTEM:")
  let t = unlabel(
    String(v ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
  ).replace(/[<>`{}\[\]\\]/g, "");

  t = unlabel(t);

  for (const re of INJECT) {
    t = t.replace(re, "(...)");
  }

  return t
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
