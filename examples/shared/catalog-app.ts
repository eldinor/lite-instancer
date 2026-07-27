import {
  EXAMPLES,
  EXAMPLE_CATEGORIES,
  examplePath,
  type ExampleCatalogEntry,
  type ExampleCategory
} from "./catalog.js";
import "./catalog.css";

const grid = document.querySelector<HTMLElement>("[data-catalog]");
const search = document.querySelector<HTMLInputElement>("[data-search]");
const filters = document.querySelector<HTMLElement>("[data-filters]");
const count = document.querySelector<HTMLElement>("[data-result-count]");

if (!grid || !search || !filters || !count) {
  throw new Error("Example catalog shell is incomplete");
}

const catalogGrid = grid;
const catalogSearch = search;
const catalogFilters = filters;
const resultCount = count;
let activeCategory: ExampleCategory | "All" = "All";

for (const category of ["All", ...EXAMPLE_CATEGORIES] as const) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "catalog-filter";
  button.textContent = category;
  button.setAttribute("aria-pressed", String(category === activeCategory));
  button.addEventListener("click", () => {
    activeCategory = category;
    for (const sibling of catalogFilters.querySelectorAll<HTMLButtonElement>("button")) {
      sibling.setAttribute("aria-pressed", String(sibling === button));
    }
    render();
  });
  catalogFilters.append(button);
}

catalogSearch.addEventListener("input", render);
render();

function render(): void {
  const query = catalogSearch.value.trim().toLocaleLowerCase();
  const visible = EXAMPLES.filter((entry) => {
    if (activeCategory !== "All" && entry.category !== activeCategory) return false;
    if (!query) return true;
    return [entry.title, entry.description, entry.category, ...entry.tags]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });

  catalogGrid.replaceChildren();
  for (const category of EXAMPLE_CATEGORIES) {
    const entries = visible.filter((entry) => entry.category === category);
    if (entries.length === 0) continue;
    catalogGrid.append(createGroup(category, entries));
  }
  resultCount.textContent = `${visible.length} ${visible.length === 1 ? "example" : "examples"}`;
  catalogGrid.toggleAttribute("data-empty", visible.length === 0);
}

function createGroup(category: ExampleCategory, entries: readonly ExampleCatalogEntry[]): HTMLElement {
  const section = document.createElement("section");
  section.className = "catalog-group";
  const heading = document.createElement("h2");
  heading.textContent = category;
  const cards = document.createElement("div");
  cards.className = "catalog-grid";
  for (const entry of entries) cards.append(createCard(entry));
  section.append(heading, cards);
  return section;
}

function createCard(entry: ExampleCatalogEntry): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "catalog-card";
  link.href = examplePath(entry);

  const eyebrow = document.createElement("span");
  eyebrow.className = "catalog-card__eyebrow";
  eyebrow.textContent = entry.category;
  const title = document.createElement("strong");
  title.textContent = entry.title;
  const description = document.createElement("span");
  description.className = "catalog-card__description";
  description.textContent = entry.description;
  const tags = document.createElement("span");
  tags.className = "catalog-card__tags";
  for (const value of entry.tags) {
    const tag = document.createElement("small");
    tag.textContent = value;
    tags.append(tag);
  }
  link.append(eyebrow, title, description, tags);
  return link;
}
