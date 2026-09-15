export interface PokeTemplate {
  id: string;
  label: string;
  text: string;
}

export const QUICK_POKES: PokeTemplate[] = [
  { id: "hi", label: "Hi!", text: "Hi!" },
  { id: "coffee", label: "Coffee", text: "Coffee?" },
  { id: "heart", label: "Love", text: "<3" },
  { id: "poke", label: "Poke!", text: "Poke!" },
  { id: "gg", label: "GG", text: "GG" },
  { id: "lol", label: "LOL", text: "LOL" },
];

export const POKE_TEMPLATES: PokeTemplate[] = [
  { id: "gm", label: "Good morning", text: "Good morning!" },
  { id: "gn", label: "Good night", text: "Good night!" },
  { id: "brb", label: "BRB", text: "BRB" },
  { id: "hungry", label: "Hungry", text: "Food time?" },
  { id: "wave", label: "Wave", text: "Wave!" },
  { id: "miss", label: "Miss you", text: "Miss you" },
];
