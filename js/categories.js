import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import { createCategory, getCategories } from "./db.js";

export async function initCategoriesPage() {
  const user = await requireAuthPage();
  bindAuthUi(user);
  registerPwaWorker();

  const categoryForm = document.getElementById("categoryForm");
  const categoriesTableBody = document.getElementById("categoriesTableBody");
  const categoryModal = document.getElementById("categoryModal");
  const openCategoryModalBtn = document.getElementById("openCategoryModalBtn");
  const closeCategoryModalBtn = document.getElementById("closeCategoryModalBtn");

  let categories = [];
  const familyDefaults = [
    { name: "Sonstiges", type: "expense" },
    { name: "Miete/Wohnen", type: "expense" },
    { name: "Strom/Internet/Versicherung", type: "expense" },
    { name: "Lebensmittel", type: "expense" },
    { name: "Kinder", type: "expense" },
    { name: "Sprit/Transport", type: "expense" },
    { name: "Arbeit/Werkzeug", type: "expense" },
    { name: "Gesundheit", type: "expense" },
    { name: "Hochzeit", type: "expense" },
    { name: "Notgroschen", type: "expense" },
    { name: "Lohn", type: "income" }
  ];

  function openCategoryModal() {
    categoryModal.classList.remove("hidden");
    document.getElementById("categoryName").focus();
  }

  function closeCategoryModal() {
    categoryModal.classList.add("hidden");
  }

  function renderCategoryTable() {
    if (!categories.length) {
      categoriesTableBody.innerHTML =
        '<tr><td colspan="2"><div class="empty-state">Noch keine Kategorien vorhanden.</div></td></tr>';
      return;
    }

    categoriesTableBody.innerHTML = categories
      .map((category) => {
        return `
          <tr>
            <td>${category.name}</td>
            <td class="capitalize">${category.type === "expense" ? "Ausgabe" : category.type === "income" ? "Einnahme" : "Beides"}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function refreshCategories() {
    categories = await getCategories(user.uid);
    renderCategoryTable();
  }

  async function ensureInitialCategories() {
    if (categories.length) {
      return;
    }

    for (const item of familyDefaults) {
      await createCategory(user.uid, {
        name: item.name,
        type: item.type,
        parent_id: ""
      });
    }

    categories = await getCategories(user.uid);
    showToast("Standard-Kategorien wurden automatisch angelegt.");
  }

  openCategoryModalBtn.addEventListener("click", openCategoryModal);
  closeCategoryModalBtn.addEventListener("click", closeCategoryModal);

  categoryModal.addEventListener("click", (event) => {
    if (event.target === categoryModal) {
      closeCategoryModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !categoryModal.classList.contains("hidden")) {
      closeCategoryModal();
    }
  });

  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("categoryName").value.trim();
    const type = document.getElementById("categoryType").value;

    if (!name) {
      showToast("Bitte Name eingeben.");
      return;
    }

    await createCategory(user.uid, { name, type, parent_id: "" });

    categoryForm.reset();
    document.getElementById("categoryType").value = "expense";
    closeCategoryModal();
    showToast("Kategorie gespeichert.");
    await refreshCategories();
  });

  await refreshCategories();
  await ensureInitialCategories();
  renderCategoryTable();
}
