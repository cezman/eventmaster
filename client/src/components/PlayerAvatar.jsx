import { BigHead } from "@bigheads/core";

// у BigHead все незаданные пропсы рандомизируются при каждом рендере,
// поэтому всегда передаём полный набор значений
export const AVATAR_DEFAULTS = {
  skinTone: "light",
  eyes: "normal",
  eyebrows: "raised",
  mouth: "grin",
  hair: "short",
  facialHair: "none",
  clothing: "shirt",
  accessory: "none",
  graphic: "none",
  hat: "none",
  body: "chest",
  hairColor: "brown",
  clothingColor: "blue",
  circleColor: "blue",
  lipColor: "red",
  hatColor: "blue",
  faceMaskColor: "white",
  mask: false,
  faceMask: false,
  lashes: false,
};

// аватар хранится как JSON-строка пропсов BigHead либо как эмодзи (старые записи)
export function parseAvatar(avatar) {
  if (typeof avatar === "string" && avatar.startsWith("{")) {
    try {
      return JSON.parse(avatar);
    } catch {
      return null;
    }
  }
  return null;
}

export default function PlayerAvatar({ avatar, size = 32 }) {
  const props = parseAvatar(avatar);
  if (props) {
    return (
      <BigHead
        {...AVATAR_DEFAULTS}
        {...props}
        style={{ width: size, height: size, display: "inline-block", verticalAlign: "middle" }}
      />
    );
  }
  return <span style={{ fontSize: Math.round(size * 0.85) }}>{avatar || "🙂"}</span>;
}
