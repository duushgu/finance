import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import {
  calculateAccountBalances,
  createAccount,
  deleteAccount,
  formatCurrency,
  getAccounts,
  getTransactions,
  updateAccount
} from "./db.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCompactAmountInput(rawValue) {
  const compact = String(rawValue || "")
    .trim()
    .toLowerCase()
    .replaceAll("₮", "")
    .replace(/\s+/g, "");

  if (!compact) {
    return Number.NaN;
  }

  const normalized = compact.replace(",", ".");
  const match = normalized.match(/^([+-]?\d+(?:\.\d+)?)(k)?$/);
  if (!match) {
    return Number.NaN;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base)) {
    return Number.NaN;
  }

  const expanded = match[2] ? base * 1000 : base;
  return Math.round(expanded);
}

export async function initAccountsPage() {
  const user = await requireAuthPage();
  bindAuthUi(user);
  registerPwaWorker();

  const accountForm = document.getElementById("accountForm");
  const accountsTableBody = document.getElementById("accountsTableBody");
  const accountModal = document.getElementById("accountModal");
  const openAccountModalBtn = document.getElementById("openAccountModalBtn");
  const closeAccountModalBtn = document.getElementById("closeAccountModalBtn");
  const toggleDeleteAccountModeBtn = document.getElementById("toggleDeleteAccountModeBtn");

  let accountsWithBalance = [];
  let isInlineSaving = false;
  let isDeleteMode = false;
  let selectedDeleteAccountId = "";

  async function waitForInlineSaveIdle(timeoutMs = 1200) {
    const startedAt = Date.now();
    while (isInlineSaving && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => window.setTimeout(resolve, 35));
    }
  }

  function openAccountModal() {
    accountModal.classList.remove("hidden");
    document.getElementById("accountName").focus();
  }

  function closeAccountModal() {
    accountModal.classList.add("hidden");
  }

  function getAccountById(accountId) {
    return accountsWithBalance.find((item) => item.id === accountId);
  }

  function applyDeleteModeStateToTable() {
    const rows = Array.from(accountsTableBody.querySelectorAll("tr[data-account-id]"));
    rows.forEach((row) => {
      const isSelected = isDeleteMode && row.dataset.accountId === selectedDeleteAccountId;
      row.classList.toggle("row-selectable", isDeleteMode);
      row.classList.toggle("row-selected", isSelected);
    });

    const editableCells = accountsTableBody.querySelectorAll(".editable-cell");
    editableCells.forEach((cell) => {
      cell.setAttribute("contenteditable", isDeleteMode ? "false" : "true");
    });
  }

  function updateDeleteButtonUi() {
    if (!toggleDeleteAccountModeBtn) {
      return;
    }

    toggleDeleteAccountModeBtn.classList.toggle("is-active", isDeleteMode);
    toggleDeleteAccountModeBtn.textContent = "DEL";

    if (!isDeleteMode) {
      toggleDeleteAccountModeBtn.title = "Löschmodus starten";
      toggleDeleteAccountModeBtn.setAttribute("aria-label", "Löschmodus starten");
      return;
    }

    if (selectedDeleteAccountId) {
      toggleDeleteAccountModeBtn.title = "Ausgewählte Zeile löschen";
      toggleDeleteAccountModeBtn.setAttribute("aria-label", "Ausgewählte Zeile löschen");
      return;
    }

    toggleDeleteAccountModeBtn.title = "Löschmodus beenden";
    toggleDeleteAccountModeBtn.setAttribute("aria-label", "Löschmodus beenden");
  }

  function setDeleteMode(nextMode) {
    isDeleteMode = nextMode;
    if (!isDeleteMode) {
      selectedDeleteAccountId = "";
    }
    updateDeleteButtonUi();
    applyDeleteModeStateToTable();
  }

  async function renderAccounts() {
    const [accounts, transactions] = await Promise.all([getAccounts(user.uid), getTransactions(user.uid)]);
    accountsWithBalance = calculateAccountBalances(accounts, transactions);

    if (!accountsWithBalance.length) {
      accountsTableBody.innerHTML =
        '<tr><td colspan="2"><div class="empty-state">Noch kein Konto vorhanden. Bitte zuerst ein Konto anlegen.</div></td></tr>';
      selectedDeleteAccountId = "";
      applyDeleteModeStateToTable();
      return;
    }

    if (selectedDeleteAccountId && !accountsWithBalance.some((item) => item.id === selectedDeleteAccountId)) {
      selectedDeleteAccountId = "";
    }

    accountsTableBody.innerHTML = accountsWithBalance
      .map((account) => {
        const netActivity = Number(account.current_balance || 0) - Number(account.initial_balance || 0);
        const selectedClass = isDeleteMode && account.id === selectedDeleteAccountId ? " row-selected" : "";
        const selectableClass = isDeleteMode ? " row-selectable" : "";
        return `
          <tr data-account-id="${account.id}" data-net-activity="${netActivity}" class="${selectableClass}${selectedClass}">
            <td
              class="editable-cell"
              contenteditable="true"
              data-field="name"
              spellcheck="false"
            >${escapeHtml(account.name)}</td>
            <td
              class="editable-cell font-semibold"
              contenteditable="true"
              data-field="current_balance"
              spellcheck="false"
            >${formatCurrency(account.current_balance)}</td>
          </tr>
        `;
      })
      .join("");

    applyDeleteModeStateToTable();
  }

  async function saveCellUpdate(cell) {
    const field = cell.dataset.field;
    const row = cell.closest("tr");
    if (!row) {
      return false;
    }

    const accountId = row.dataset.accountId;
    const account = getAccountById(accountId);
    if (!account) {
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
        throw new Error("Kontoname darf nicht leer sein.");
      }

      await updateAccount(accountId, { name: nextName });
      return true;
    }

    if (field === "current_balance") {
      const targetCurrentBalance = parseCompactAmountInput(currentText);
      if (!Number.isFinite(targetCurrentBalance)) {
        throw new Error("Ungültiger Kontostand. Beispiel: 25000 oder 25k.");
      }

      const netActivity = Number(row.dataset.netActivity || 0);
      const nextInitialBalance = targetCurrentBalance - netActivity;
      await updateAccount(accountId, { initial_balance: nextInitialBalance });
      return true;
    }

    return false;
  }

  openAccountModalBtn.addEventListener("click", openAccountModal);
  closeAccountModalBtn.addEventListener("click", closeAccountModal);

  accountModal.addEventListener("click", (event) => {
    if (event.target === accountModal) {
      closeAccountModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !accountModal.classList.contains("hidden")) {
      closeAccountModal();
    }
  });

  accountsTableBody.addEventListener("focusin", (event) => {
    if (isDeleteMode) {
      return;
    }

    const cell = event.target.closest(".editable-cell");
    if (!cell) {
      return;
    }
    cell.dataset.originalValue = cell.textContent.trim();
  });

  accountsTableBody.addEventListener("keydown", (event) => {
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

  accountsTableBody.addEventListener("focusout", async (event) => {
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
        await renderAccounts();
        showToast("Konto aktualisiert.");
      }
    } catch (error) {
      cell.textContent = cell.dataset.originalValue || "";
      showToast(error.message || "Aktualisierung fehlgeschlagen.");
    } finally {
      isInlineSaving = false;
    }
  });

  accountsTableBody.addEventListener("click", (event) => {
    if (!isDeleteMode) {
      return;
    }

    const row = event.target.closest("tr[data-account-id]");
    if (!row) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectedDeleteAccountId = row.dataset.accountId || "";
    applyDeleteModeStateToTable();
    updateDeleteButtonUi();
  });

  toggleDeleteAccountModeBtn?.addEventListener("click", async () => {
    await waitForInlineSaveIdle();

    if (!isDeleteMode) {
      setDeleteMode(true);
      showToast("Löschmodus aktiv: Zeile antippen, dann DEL drücken.");
      return;
    }

    if (!selectedDeleteAccountId) {
      setDeleteMode(false);
      showToast("Löschmodus beendet.");
      return;
    }

    const accountId = selectedDeleteAccountId;
    const account = getAccountById(accountId);
    if (!accountId || !account) {
      setDeleteMode(false);
      showToast("Keine gültige Zeile ausgewählt.");
      return;
    }

    const confirmDelete = window.confirm(`Konto "${account.name}" wirklich löschen?`);
    if (!confirmDelete) {
      return;
    }

    toggleDeleteAccountModeBtn.disabled = true;
    try {
      await deleteAccount(accountId);
      showToast("Konto gelöscht.");
      selectedDeleteAccountId = "";
      await renderAccounts();
      setDeleteMode(false);
    } catch (error) {
      showToast(error.message || "Konto konnte nicht gelöscht werden.");
    } finally {
      toggleDeleteAccountModeBtn.disabled = false;
      updateDeleteButtonUi();
      applyDeleteModeStateToTable();
    }
  });

  accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("accountName").value.trim();
    const initialBalance = document.getElementById("accountInitialBalance").value;

    if (!name) {
      showToast("Bitte Kontonamen eingeben.");
      return;
    }

    await createAccount(user.uid, {
      name,
      initial_balance: initialBalance
    });

    accountForm.reset();
    document.getElementById("accountInitialBalance").value = "0";
    closeAccountModal();
    showToast("Konto gespeichert.");
    await renderAccounts();
  });

  await renderAccounts();
  updateDeleteButtonUi();
}
