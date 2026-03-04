members = [];
expenses = [];
let lastArchiveAt = null;

const STORAGE_KEY = 'terminalDataV1';

function createDefaultStore() {
  return {
    members: [],
    expenses: [],
    archives: []
  };
}

function readStore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultStore();
    const parsed = JSON.parse(raw);
    return {
      members: Array.isArray(parsed.members) ? parsed.members : [],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      archives: Array.isArray(parsed.archives) ? parsed.archives : []
    };
  } catch (_) {
    return createDefaultStore();
  }
}

function writeStore(store) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getNextId(items) {
  const maxId = items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  return maxId + 1;
}

window.onload = async function() {
  await loadData();
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function userIconSvg() {
  return (
    '<span class="svg-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 21a8 8 0 0 0-16 0"></path>' +
    '<circle cx="12" cy="7" r="4"></circle>' +
    '</svg>' +
    '</span>'
  );
}

function cartIconSvg() {
  return (
    '<span class="svg-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="9" cy="20" r="1"></circle>' +
    '<circle cx="20" cy="20" r="1"></circle>' +
    '<path d="M1 1h4l2.5 12.5a2 2 0 0 0 2 1.5h8.7a2 2 0 0 0 2-1.6L23 6H6"></path>' +
    '</svg>' +
    '</span>'
  );
}

function formatDateTime(date) {
  return date.toLocaleString('ar-SA', {
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatAmount(value) {
  const number = Number(value) || 0;
  return number.toLocaleString('ar-SA', {
    numberingSystem: 'latn',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function updateArchiveInfo() {
  const archiveEl = document.getElementById('lastArchiveDisplay');
  if (!archiveEl) return;
  archiveEl.textContent = lastArchiveAt ? formatDateTime(lastArchiveAt) : 'لا توجد أرشفة';
}

function setLastArchive(value) {
  lastArchiveAt = value ? new Date(value) : null;
  updateArchiveInfo();
}

function notify(message, type = 'error') {
  const container = document.getElementById('toastContainer');
  if (!container) {
    alert(message);
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2600);
}

async function loadData() {
  try {
    const store = readStore();
    members = store.members
      .map((m) => ({
        id: Number(m.id) || 0,
        name: String(m.name || '').trim(),
        paid: Number(m.paid) || 0
      }))
      .filter((m) => m.id > 0 && m.name);

    expenses = store.expenses
      .map((e) => ({
        id: Number(e.id) || 0,
        desc: String(e.desc || e.description || '').trim(),
        amount: Number(e.amount) || 0,
        createdAt: e.createdAt || new Date().toISOString()
      }))
      .filter((e) => e.id > 0 && e.desc && e.amount > 0);

    const latestArchive = store.archives.length ? store.archives[store.archives.length - 1] : null;
    setLastArchive(latestArchive ? latestArchive.archivedAt : null);

    updateMembersUI();
    updateExpensesUI();
  } catch (_) {
    notify('تعذر تحميل البيانات', 'error');
  }
}

function persistCurrentData() {
  const store = readStore();
  store.members = members.map((m) => ({ id: m.id, name: m.name, paid: Number(m.paid) || 0 }));
  store.expenses = expenses.map((e) => ({
    id: e.id,
    desc: e.desc,
    amount: Number(e.amount) || 0,
    createdAt: e.createdAt
  }));
  writeStore(store);
}

function calculateAll() {
  const totalExpenses = expenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
  const totalCollected = members.reduce((sum, member) => sum + (Number(member.paid) || 0), 0);
  const balance = totalCollected - totalExpenses;

  document.getElementById('totalExpensesDisplay').textContent = formatAmount(totalExpenses);
  document.getElementById('totalCollectedDisplay').textContent = formatAmount(totalCollected);

  const balanceEl = document.getElementById('boxBalanceDisplay');
  balanceEl.textContent = formatAmount(balance);
  balanceEl.style.color = balance < 0 ? 'var(--danger)' : 'var(--primary)';
}

async function updatePaid(memberId, value) {
  const paid = parseFloat(value);
  const normalizedPaid = Number.isFinite(paid) && paid >= 0 ? paid : 0;

  try {
    const member = members.find((m) => m.id === memberId);
    if (!member) throw new Error('member not found');
    member.paid = normalizedPaid;
    persistCurrentData();
    calculateAll();
  } catch (_) {
    notify('تعذر تحديث المبلغ', 'error');
    await loadData();
  }
}

async function addMember() {
  const nameInput = document.getElementById('newMember');
  const name = nameInput.value.trim();
  if (!name) return;

  try {
    const newMember = { id: getNextId(members), name, paid: 0 };
    members.push(newMember);
    persistCurrentData();
    nameInput.value = '';
    updateMembersUI();
    notify('تمت إضافة العضو', 'success');
  } catch (_) {
    notify('تعذر إضافة العضو', 'error');
  }
}

async function deleteMember(memberId) {
  try {
    members = members.filter((m) => m.id !== memberId);
    persistCurrentData();
    updateMembersUI();
    notify('تم حذف العضو', 'success');
  } catch (_) {
    notify('تعذر حذف العضو', 'error');
  }
}

function updateMembersUI() {
  const list = document.getElementById('membersList');
  document.getElementById('membersCount').textContent = members.length;

  if (members.length === 0) {
    list.innerHTML = '<li class="empty-state">لا يوجد شباب في القائمة.</li>';
    calculateAll();
    return;
  }

  list.innerHTML = '';
  members.forEach((member) => {
    const li = document.createElement('li');
    li.className = 'member-item';
    const paidValue = Number(member.paid) > 0 ? String(member.paid) : '';
    li.innerHTML =
      '<div class="member-info">' +
      '<span>' + userIconSvg() + ' ' + escapeHtml(member.name) + '</span>' +
      '</div>' +
      '<div class="member-actions">' +
      '<div class="paid-input-group">' +
      '<label>دفع:</label>' +
      '<input type="number" min="0" value="' + paidValue + '" onchange="updatePaid(' + member.id + ', this.value)">' +
      '</div>' +
      '<button class="btn-delete" onclick="deleteMember(' + member.id + ')">حذف</button>' +
      '</div>';
    list.appendChild(li);
  });

  calculateAll();
}

async function addExpense() {
  const descInput = document.getElementById('expenseDesc');
  const amountInput = document.getElementById('expenseAmount');
  const desc = descInput.value.trim();
  const amount = parseFloat(amountInput.value);

  if (!desc || !(amount > 0)) return;

  try {
    const newExpense = {
      id: getNextId(expenses),
      desc,
      amount,
      createdAt: new Date().toISOString()
    };

    expenses.unshift(newExpense);
    persistCurrentData();
    descInput.value = '';
    amountInput.value = '';
    updateExpensesUI();
    notify('تمت إضافة المصروف', 'success');
  } catch (_) {
    notify('تعذر إضافة المصروف', 'error');
  }
}

async function deleteExpense(expenseId) {
  try {
    expenses = expenses.filter((exp) => exp.id !== expenseId);
    persistCurrentData();
    updateExpensesUI();
    notify('تم حذف المصروف', 'success');
  } catch (_) {
    notify('تعذر حذف المصروف', 'error');
  }
}

async function archiveAllData() {
  try {
    const store = readStore();
    const archiveRecord = {
      id: getNextId(store.archives),
      archivedAt: new Date().toISOString(),
      members: members.map((m) => ({ name: m.name, paid: Number(m.paid) || 0 })),
      expenses: expenses.map((e) => ({ desc: e.desc, amount: Number(e.amount) || 0 }))
    };

    store.archives.push(archiveRecord);
    store.members = [];
    store.expenses = [];
    writeStore(store);

    members = [];
    expenses = [];
    setLastArchive(archiveRecord.archivedAt);
    updateMembersUI();
    updateExpensesUI();
    notify('تمت أرشفة جميع المدخلات', 'success');
  } catch (_) {
    notify('تعذر تنفيذ الأرشفة', 'error');
  }
}

function updateExpensesUI() {
  const list = document.getElementById('expensesList');

  if (expenses.length === 0) {
    list.innerHTML = '<li class="empty-state">لا توجد مصروفات مسجلة.</li>';
    calculateAll();
    return;
  }

  list.innerHTML = '';
  expenses.forEach((exp) => {
    const li = document.createElement('li');
    li.className = 'expense-item';
    li.innerHTML =
      '<div class="expense-info">' +
      '<span class="expense-desc">' + cartIconSvg() + ' ' + escapeHtml(exp.desc) + '</span>' +
      '<span class="expense-price">' + formatAmount(Number(exp.amount) || 0) + ' ريال</span>' +
      '</div>' +
      '<button class="btn-delete" onclick="deleteExpense(' + exp.id + ')">حذف</button>';
    list.appendChild(li);
  });

  calculateAll();
}
