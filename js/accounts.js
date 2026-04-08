import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import {
  calculateAccountBalances,
  createAccount,
  formatCurrency,
  getAccounts,
  getTransactions
} from "./db.js";

export async function initAccountsPage() {
  const user = await requireAuthPage();
  bindAuthUi(user);
  registerPwaWorker();

  const accountForm = document.getElementById("accountForm");
  const accountsTableBody = document.getElementById("accountsTableBody");
  const accountModal = document.getElementById("accountModal");
  const openAccountModalBtn = document.getElementById("openAccountModalBtn");
  const closeAccountModalBtn = document.getElementById("closeAccountModalBtn");

  function openAccountModal() {
    accountModal.classList.remove("hidden");
    document.getElementById("accountName").focus();
  }

  function closeAccountModal() {
    accountModal.classList.add("hidden");
  }

  async function renderAccounts() {
    const [accounts, transactions] = await Promise.all([getAccounts(user.uid), getTransactions(user.uid)]);
    const accountsWithBalance = calculateAccountBalances(accounts, transactions);

    if (!accountsWithBalance.length) {
      accountsTableBody.innerHTML =
        '<tr><td colspan="2"><div class="empty-state">Noch kein Konto vorhanden. Bitte zuerst ein Konto anlegen.</div></td></tr>';
      return;
    }

    accountsTableBody.innerHTML = accountsWithBalance
      .map((account) => {
        return `
          <tr>
            <td>${account.name}</td>
            <td class="font-semibold">${formatCurrency(account.current_balance)}</td>
          </tr>
        `;
      })
      .join("");
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
}
