// наборы для кастомизации игрока в лобби
// аватар — Big Heads (https://bigheads.io, MIT): конструктор из готовых пропсов
export const HAIR_OPTIONS = [
  ["short", "Короткая"],
  ["long", "Длинная"],
  ["bun", "Пучок"],
  ["pixie", "Пикси"],
  ["bob", "Каре"],
  ["afro", "Афро"],
  ["buzz", "Ёжик"],
  ["balding", "Лысина"],
  ["none", "Нет"],
];

export const CLOTHING_OPTIONS = [
  ["shirt", "Футболка"],
  ["dressShirt", "Рубашка"],
  ["vneck", "Вник"],
  ["tankTop", "Майка"],
  ["dress", "Платье"],
];

export const COLOR_OPTIONS = [
  ["blue", "Синий"],
  ["black", "Чёрный"],
  ["green", "Зелёный"],
  ["red", "Красный"],
  ["white", "Белый"],
];

export const BODY_OPTIONS = [
  ["chest", " Мужской"],
  ["breasts", " Женский"],
];

export const SKIN_OPTIONS = [
  ["light", "Светлая"],
  ["yellow", "Жёлтая"],
  ["brown", "Смуглая"],
  ["dark", "Тёмная"],
  ["red", "Красная"],
  ["black", "Чёрная"],
];

export const HAIR_COLOR_OPTIONS = [
  ["brown", "Каштановые"],
  ["blonde", "Блонд"],
  ["orange", "Рыжие"],
  ["black", "Чёрные"],
  ["white", "Седые"],
  ["blue", "Синие"],
  ["pink", "Розовые"],
];

// готовые аватары — быстрый выбор одним нажатием
export const AVATAR_PRESETS = [
  { label: "Классика", props: { skinTone: "light", body: "chest", eyes: "normal", hair: "short", hairColor: "brown", facialHair: "none", mouth: "grin", clothing: "shirt", clothingColor: "blue", accessory: "none", hat: "none" } },
  { label: "Рыжинка", props: { skinTone: "light", body: "breasts", lashes: true, eyes: "wink", hair: "long", hairColor: "orange", facialHair: "none", mouth: "openSmile", clothing: "dress", clothingColor: "red", accessory: "none", hat: "none" } },
  { label: "Борода", props: { skinTone: "light", body: "chest", eyes: "content", hair: "short", hairColor: "black", facialHair: "mediumBeard", mouth: "serious", clothing: "dressShirt", clothingColor: "black", accessory: "none", hat: "none" } },
  { label: "Афро", props: { skinTone: "brown", body: "chest", eyes: "happy", hair: "afro", hairColor: "black", facialHair: "none", mouth: "grin", clothing: "tankTop", clothingColor: "green", accessory: "none", hat: "none" } },
  { label: "Пикси", props: { skinTone: "yellow", body: "breasts", lashes: true, eyes: "normal", hair: "pixie", hairColor: "pink", facialHair: "none", mouth: "lips", lipColor: "pink", clothing: "vneck", clothingColor: "white", accessory: "none", hat: "none" } },
  { label: "Шапка", props: { skinTone: "light", body: "chest", eyes: "simple", hair: "buzz", hairColor: "brown", facialHair: "stubble", mouth: "open", clothing: "shirt", clothingColor: "red", accessory: "none", hat: "beanie", hatColor: "blue" } },
  { label: "Очки", props: { skinTone: "dark", body: "chest", eyes: "squint", hair: "bob", hairColor: "black", facialHair: "none", mouth: "grin", clothing: "shirt", clothingColor: "white", accessory: "roundGlasses", hat: "none" } },
  { label: "Шэйдсы", props: { skinTone: "light", body: "breasts", lashes: true, eyes: "normal", hair: "bun", hairColor: "blonde", facialHair: "none", mouth: "serious", clothing: "dressShirt", clothingColor: "black", accessory: "shades", hat: "none" } },
];

export function randomAvatarProps() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const val = (arr) => pick(arr)[0];
  return {
    skinTone: val(SKIN_OPTIONS),
    body: pick(["chest", "breasts"]),
    eyes: pick(["normal", "happy", "content", "squint", "simple", "wink"]),
    eyebrows: pick(["raised", "serious", "concerned"]),
    hair: val(HAIR_OPTIONS),
    hairColor: val(HAIR_COLOR_OPTIONS),
    facialHair: pick(["none", "none", "stubble"]),
    mouth: pick(["grin", "openSmile", "serious", "open"]),
    clothing: val(CLOTHING_OPTIONS),
    clothingColor: val(COLOR_OPTIONS),
    accessory: pick(["none", "none", "none", "roundGlasses", "shades"]),
    hat: pick(["none", "none", "none", "beanie"]),
    hatColor: val(COLOR_OPTIONS),
  };
}

export const NAME_COLORS = [
  "#ff4d6d",
  "#4d79ff",
  "#ffb020",
  "#2fbf4d",
  "#b04dff",
  "#ff7a29",
  "#00c2c7",
  "#ff4dd2",
];

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "👏"];

export const TIME_OPTIONS = [10, 20, 30, 45, 60, 90];
