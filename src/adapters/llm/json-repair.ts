/* Resilient JSON extraction & repair for free, local, and chatty LLMs.
   Handles markdown fences, leading/trailing chatter, JS comments, trailing commas,
   and unescaped literal newlines/tabs inside JSON strings. */

function extractBalancedJson(src: string): string | null {
  let start = -1;
  let openChar = "";
  let closeChar = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{" || ch === "[") {
      start = i;
      openChar = ch;
      closeChar = ch === "{" ? "}" : "]";
      break;
    }
  }
  if (start === -1) return null;

  const stack: string[] = [closeChar];
  let inString = false;
  let escaped = false;

  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push("}");
    } else if (ch === "[") {
      stack.push("]");
    } else if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] === ch) {
        stack.pop();
        if (stack.length === 0) {
          return src.slice(start, i + 1);
        }
      }
    }
  }

  // Fallback if output truncated slightly: close open string & brackets
  let candidate = src.slice(start);
  if (inString) candidate += '"';
  while (stack.length > 0) {
    candidate += stack.pop();
  }
  void openChar;
  return candidate;
}

function sanitizeJsonCharacters(jsonLike: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonLike.length; i++) {
    const ch = jsonLike[i];
    const next = jsonLike[i + 1];

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") {
        continue;
      }
      if (ch === "\t") {
        out += "\\t";
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += " ";
        continue;
      }
      out += ch;
      continue;
    }

    // Outside strings: strip // line comments and /* block comments */
    if (ch === "/" && next === "/") {
      while (i < jsonLike.length && jsonLike[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < jsonLike.length && !(jsonLike[i] === "*" && jsonLike[i + 1] === "/")) i++;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    out += ch;
  }

  // Strip trailing commas before } or ] (outside strings)
  let cleaned = "";
  inString = false;
  escaped = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inString) {
      cleaned += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      cleaned += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] === "}" || out[j] === "]") {
        continue; // drop trailing comma
      }
    }
    cleaned += ch;
  }

  return cleaned;
}

export function extractAndRepairJson<T = any>(rawText: string): T {
  const withoutThink = String(rawText ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "");
  const trimmed = withoutThink.trim();
  if (!trimmed) {
    throw new Error("Model returned an empty response where JSON was expected.");
  }

  // Fast path: already valid JSON
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // continue to extraction & repair
  }

  // Strip markdown code fences if present
  const fenceMatch = trimmed.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  const unfenced = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(unfenced) as T;
  } catch {
    // continue
  }

  const extracted = extractBalancedJson(unfenced) ?? extractBalancedJson(trimmed);
  if (!extracted) {
    throw new Error("Could not find a JSON object or array in the model response.");
  }

  try {
    return JSON.parse(extracted) as T;
  } catch {
    const repaired = sanitizeJsonCharacters(extracted);
    return JSON.parse(repaired) as T;
  }
}
