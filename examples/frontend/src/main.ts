import { createQuery, op } from '@queryjs/client';

// We mirror the exact shape of the backend query definition to get strictly typed query building
interface UserQueryContract {
  name: string;
  email: string;
  age: number;
  status: 'ACTIVE' | 'INACTIVE';
  role: 'admin' | 'editor' | 'viewer';
  createdAt: string;
}

// The DOM elements
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const statusFilter = document.getElementById('statusFilter') as HTMLSelectElement;
const roleFilter = document.getElementById('roleFilter') as HTMLSelectElement;
const sortField = document.getElementById('sortField') as HTMLSelectElement;
const descBtn = document.getElementById('descBtn') as HTMLButtonElement;
const resultsPre = document.getElementById('results') as HTMLPreElement;
const urlDisplay = document.getElementById('urlDisplay') as HTMLDivElement;

let isDesc = true;

// You can change this to match whichever backend example you are running
// e.g. http://localhost:3001 for express-prisma
const BACKEND_URL = 'http://localhost:3001';

async function fetchUsers() {
  const term = searchInput.value.trim() || undefined;
  const status = (statusFilter.value as UserQueryContract['status']) || undefined;
  const role = (roleFilter.value as UserQueryContract['role']) || undefined;
  const sortKey = (sortField.value as keyof UserQueryContract) || undefined;

  const urlParams = createQuery<UserQueryContract>()
    .paginate({ page: 1, limit: 15 })
    .search(term, 'prefix')
    .filter('status', status ? op.equals(status) : undefined)
    .filter('role', role ? op.equals(role) : undefined)
    .sort(sortKey, isDesc ? 'desc' : 'asc')
    .toString();

  const urlPath = `/users?${urlParams}`;
  const fullUrl = `${BACKEND_URL}${urlPath}`;

  // Update UI
  urlDisplay.textContent = urlPath;
  resultsPre.textContent = 'Fetching...';

  // Hit the backend
  try {
    const response = await fetch(fullUrl);
    const data = (await response.json()) as { error?: { message?: string } };

    if (response.ok) {
      resultsPre.textContent = JSON.stringify(data, null, 2);
    } else {
      resultsPre.textContent = `Error: ${data.error?.message || 'Unknown error'}`;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    resultsPre.textContent = `Network Error (make sure a backend example is running on port 3001): ${message}`;
  }
}

// Attach reactive listeners
const handleFetch = () => {
  void fetchUsers();
};

searchInput.addEventListener('input', handleFetch);
statusFilter.addEventListener('change', handleFetch);
roleFilter.addEventListener('change', handleFetch);
sortField.addEventListener('change', handleFetch);

descBtn.addEventListener('click', () => {
  isDesc = !isDesc;
  descBtn.textContent = isDesc ? 'Desc' : 'Asc';
  void fetchUsers();
});

// Run the initial data load
await fetchUsers();
