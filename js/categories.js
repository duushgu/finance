import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import { createCategory, deleteCategory, ensureStarterCategories, getCategories, updateCategory } from "./db.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function labelForType(type) {
  if (type === "expense") {
    return "Зарлага";
  }
  if (type === "income") {
    return "Орлого";
  }
  return "Хоёул";
}

function normalizeTypeInput(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (["зарлага", "zarlaga", "expense"].includes(normalized)) {
    return "expense";
  }
  if (["орлого", "orlogo", "income"].includes(normalized)) {
    return "income";
  }
  if (["хоёул", "хоёулаа", "хоерул", "both"].includes(normalized)) {
    return "both";
  }

  return "";
}

export async function initCategoriesPage() {
  const user = await requireAuthPage();
  bindAuthUi(user);
  registerPwaWorker();

  const categoryForm = document.getElementById("categoryForm");
  const categoriesTableBody = document.getElementById("categoriesTableBody");
  const categoryModal = document.getElementById("categoryModal");
  const openCategoryModalBtn = document.getElementById("openCategoryModalBtn");
  const closeCategoryModalBtn = document.getElementById("closeCategoryModalBtn");
  const toggleDeleteCategoryModeBtn = document.getElementById("toggleDeleteCategoryModeBtn");

  let categories = [];
  let isInlineSaving = false;
  let isDeleteMode = false;
  let selectedDeleteCategoryId = "";

  async function waitForInlineSaveIdle(timeoutMs = 1200) {
    const startedAt = Date.now();
    while (isInlineSaving && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => window.setTimeout(resolve, 35));
    }
  }

  function openCategoryModal() {
    categoryModal.classList.remove("hidden");
    document.getElementById("categoryName").focus();
  }

  function closeCategoryModal() {
    categoryModal.classList.add("hidden");
  }

  function getCategoryById(categoryId) {
    return categories.find((item) => item.id === categoryId);
  }

  function applyDeleteModeStateToTable() {
    const rows = Array.from(categoriesTableBody.querySelectorAll("tr[data-category-id]"));
    rows.forEach((row) => {
      const isSelected = isDeleteMode && row.dataset.categoryId === selectedDeleteCategoryId;
      row.classList.toggle("row-selectable", isDeleteMode);
      row.classList.toggle("row-selected", isSelected);
    });

    const editableCells = categoriesTableBody.querySelectorAll(".editable-cell");
    editableCells.forEach((cell) => {
      cell.setAttribute("contenteditable", isDeleteMode ? "false" : "true");
    });
  }

  function updateDeleteButtonUi() {
    if (!toggleDeleteCategoryModeBtn) {
      return;
    }

    toggleDeleteCategoryModeBtn.classList.toggle("is-active", isDeleteMode);
    toggleDeleteCategoryModeBtn.textContent = "УСТ";

    if (!isDeleteMode) {
      toggleDeleteCategoryModeBtn.title = "Устгах горим эхлүүлэх";
      toggleDeleteCategoryModeBtn.setAttribute("aria-label", "Устгах горим эхлүүлэх");
      return;
    }

    if (selectedDeleteCategoryId) {
      toggleDeleteCategoryModeBtn.title = "Сонгосон мөрийг устгах";
      toggleDeleteCategoryModeBtn.setAttribute("aria-label", "Сонгосон мөрийг устгах");
      return;
    }

    toggleDeleteCategoryModeBtn.title = "Устгах горим дуусгах";
    toggleDeleteCategoryModeBtn.setAttribute("aria-label", "Устгах горим дуусгах");
  }

  function setDeleteMode(nextMode) {
    isDeleteMode = nextMode;
    if (!isDeleteMode) {
      selectedDeleteCategoryId = "";
    }
    updateDeleteButtonUi();
    applyDeleteModeStateToTable();
  }

  function renderCategoryTable() {
    if (!categories.length) {
      categoriesTableBody.innerHTML =
        '<tr><td colspan="2"><div class="empty-state">Ангилал хараахан алга.</div></td></tr>';
      selectedDeleteCategoryId = "";
      applyDeleteModeStateToTable();
      return;
    }

    if (selectedDeleteCategoryId && !categories.some((item) => item.id === selectedDeleteCategoryId)) {
      selectedDeleteCategoryId = "";
    }

    categoriesTableBody.innerHTML = categories
      .map((category) => {
        const selectedClass = isDeleteMode && category.id === selectedDeleteCategoryId ? " row-selected" : "";
        const selectableClass = isDeleteMode ? " row-selectable" : "";
        return `
          <tr data-category-id="${category.id}" class="${selectableClass}${selectedClass}">
            <td class="editable-cell" contenteditable="true" data-field="name" spellcheck="false">${escapeHtml(category.name)}</td>
            <td class="editable-cell capitalize" contenteditable="true" data-field="type" spellcheck="false">${labelForType(category.type)}</td>
          </tr>
        `;
      })
      .join("");

    applyDeleteModeStateToTable();
  }

  async function refreshCategories() {
    categories = await getCategories(user.uid);
    renderCategoryTable();
  }

  async function ensureInitialCategories() {
    const result = await ensureStarterCategories(user.uid);
    categories = result.categories;
    if (result.seeded) {
      showToast("Эхний ангиллууд автоматаар нэмэгдлээ.");
      return;
    }
    if (result.migrated) {
      showToast("Стандарт ангиллууд монгол нэр рүү шинэчлэгдлээ.");
    }
  }

  async function saveCellUpdate(cell) {
    const field = cell.dataset.field;
    const row = cell.closest("tr");
    if (!row) {
      return false;
    }

    const categoryId = row.dataset.categoryId;
    const category = getCategoryById(categoryId);
    if (!category) {
      return false;
    }

    const currentText = cell.textContent.trim();
    const originalText = (cell.dataset.originalValue || "").trim();
    if (currentText === originalText) {
      return false;
    }

    if (field === "name") {
      const nextName = currentText.trim();
      if (!nextName) {
        throw new Error("Ангиллын нэр хоосон байж болохгүй.");
      }
      await updateCategory(categoryId, { name: nextName });
      return true;
    }

    if (field === "type") {
      const nextType = normalizeTypeInput(currentText);
      if (!nextType) {
        throw new Error("Төрөл нь Зарлага, Орлого эсвэл Хоёул байх ёстой.");
      }
      await updateCategory(categoryId, { type: nextType });
      return true;
    }

    return false;
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

  categoriesTableBody.addEventListener("focusin", (event) => {
    if (isDeleteMode) {
      return;
    }

    const cell = event.target.closest(".editable-cell");
    if (!cell) {
      return;
    }
    cell.dataset.originalValue = cell.textContent.trim();
  });

  categoriesTableBody.addEventListener("keydown", (event) => {
    if (isDeleteMode) {
      return;
    }

    const cell = event.target.closest(".editable-cell");
    if (!cell) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      cell.blur();
    }
  });

  categoriesTableBody.addEventListener("focusout", async (event) => {
    if (isDeleteMode) {
      return;
    }

    const cell = event.target.closest(".editable-cell");
    if (!cell || isInlineSaving) {
      return;
    }

    isInlineSaving = true;
    try {
      const changed = await saveCellUpdate(cell);
      if (changed) {
        await refreshCategories();
        showToast("Ангилал шинэчлэгдлээ.");
      }
    } catch (error) {
      cell.textContent = cell.dataset.originalValue || "";
      showToast(error.message || "Aktualisierung fehlgeschlagen.");
    } finally {
      isInlineSaving = false;
    }
  });

  categoriesTableBody.addEventListener("click", (event) => {
    if (!isDeleteMode) {
      return;
    }

    const row = event.target.closest("tr[data-category-id]");
    if (!row) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectedDeleteCategoryId = row.dataset.categoryId || "";
    applyDeleteModeStateToTable();
    updateDeleteButtonUi();
  });

  toggleDeleteCategoryModeBtn?.addEventListener("click", async () => {
    await waitForInlineSaveIdle();

    if (!isDeleteMode) {
      setDeleteMode(true);
      showToast("Устгах горим идэвхтэй: мөрөө сонгоод УСТ товч дарна уу.");
      return;
    }

    if (!selectedDeleteCategoryId) {
      setDeleteMode(false);
      showToast("Устгах горим дууслаа.");
      return;
    }

    const categoryId = selectedDeleteCategoryId;
    const category = getCategoryById(categoryId);
    if (!categoryId || !category) {
      setDeleteMode(false);
      showToast("Зөв мөр сонгогдоогүй байна.");
      return;
    }

    const confirmDelete = window.confirm(`"${category.name}" ангиллыг устгах уу?`);
    if (!confirmDelete) {
      return;
    }

    toggleDeleteCategoryModeBtn.disabled = true;
    try {
      await deleteCategory(categoryId);
      showToast("Ангилал устгагдлаа.");
      selectedDeleteCategoryId = "";
      await refreshCategories();
      setDeleteMode(false);
    } catch (error) {
      showToast(error.message || "Ангиллыг устгаж чадсангүй.");
    } finally {
      toggleDeleteCategoryModeBtn.disabled = false;
      updateDeleteButtonUi();
      applyDeleteModeStateToTable();
    }
  });

  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("categoryName").value.trim();
    const type = document.getElementById("categoryType").value;

    if (!name) {
      showToast("Нэр оруулна уу.");
      return;
    }

    await createCategory(user.uid, { name, type, parent_id: "" });

    categoryForm.reset();
    document.getElementById("categoryType").value = "expense";
    closeCategoryModal();
    showToast("Ангилал хадгалагдлаа.");
    await refreshCategories();
  });

  await refreshCategories();
  await ensureInitialCategories();
  renderCategoryTable();
  updateDeleteButtonUi();
}
