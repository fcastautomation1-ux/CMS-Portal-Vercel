// ================================================================
// ui-helpers.js
// Shared UI utilities:
//   - Searchable dropdown
//   - Checkbox multi-select dropdown
//   - Toast notification system
// Depends on: nothing (pure DOM)
// ================================================================

// ----------------------------------------------------------------
// SEARCHABLE DROPDOWN
// Enhances a <select> element with a searchable overlay dropdown
// Usage: makeSearchable('selectId') or makeSearchable(selectElement)
// ----------------------------------------------------------------
const _searchableInstances = new Map();

function makeSearchable(selectOrId) {
    const select = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId;
    if (!select || select.tagName !== 'SELECT') return;
    if (_searchableInstances.has(select)) return _searchableInstances.get(select);

    select.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-dropdown-wrapper';
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);

    const trigger = document.createElement('div');
    trigger.className = 'searchable-dropdown-trigger';
    trigger.textContent = select.options[select.selectedIndex]?.text || 'Select...';
    wrapper.appendChild(trigger);

    const panel = document.createElement('div');
    panel.className = 'searchable-dropdown-panel';

    const searchInput = document.createElement('input');
    searchInput.className = 'searchable-dropdown-search';
    searchInput.type = 'text';
    searchInput.placeholder = 'Type to search...';
    panel.appendChild(searchInput);

    const optionsList = document.createElement('div');
    optionsList.className = 'searchable-dropdown-options';
    panel.appendChild(optionsList);

    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'searchable-dropdown-empty';
    emptyMsg.textContent = 'No matches found';
    emptyMsg.style.display = 'none';
    panel.appendChild(emptyMsg);

    wrapper.appendChild(panel);

    function rebuildOptions() {
        optionsList.innerHTML = '';
        Array.from(select.options).forEach((opt, i) => {
            const div = document.createElement('div');
            div.className = 'searchable-dropdown-option';
            if (opt.value === select.value) div.classList.add('selected');
            div.textContent = opt.text;
            div.dataset.value = opt.value;
            div.dataset.index = i;
            div.addEventListener('click', () => {
                select.selectedIndex = i;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                trigger.textContent = opt.text;
                closePanel();
                optionsList.querySelectorAll('.searchable-dropdown-option').forEach(o => o.classList.remove('selected'));
                div.classList.add('selected');
            });
            optionsList.appendChild(div);
        });
        trigger.textContent = select.options[select.selectedIndex]?.text || 'Select...';
    }

    function openPanel() {
        panel.classList.add('open');
        trigger.classList.add('open');
        searchInput.value = '';
        filterOptions('');
        setTimeout(() => searchInput.focus(), 50);
    }

    function closePanel() {
        panel.classList.remove('open');
        trigger.classList.remove('open');
    }

    function filterOptions(term) {
        const lower = term.toLowerCase();
        let visibleCount = 0;
        optionsList.querySelectorAll('.searchable-dropdown-option').forEach(div => {
            const text = div.textContent.toLowerCase();
            const match = !lower || text.includes(lower);
            div.classList.toggle('hidden', !match);
            if (match) visibleCount++;
        });
        emptyMsg.style.display = visibleCount === 0 ? 'block' : 'none';
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel.classList.contains('open')) {
            closePanel();
        } else {
            document.querySelectorAll('.searchable-dropdown-panel.open').forEach(p => {
                p.classList.remove('open');
                p.previousElementSibling?.classList.remove('open');
            });
            rebuildOptions();
            openPanel();
        }
    });

    searchInput.addEventListener('input', () => filterOptions(searchInput.value));
    searchInput.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => { if (!wrapper.contains(e.target)) closePanel(); });

    const observer = new MutationObserver(() => {
        if (panel.classList.contains('open')) rebuildOptions();
        trigger.textContent = select.options[select.selectedIndex]?.text || 'Select...';
    });
    observer.observe(select, { childList: true, subtree: true, attributes: true });
    select.addEventListener('change', () => {
        trigger.textContent = select.options[select.selectedIndex]?.text || 'Select...';
    });

    const instance = { wrapper, trigger, panel, rebuildOptions, select };
    _searchableInstances.set(select, instance);
    return instance;
}

function initSearchableDropdowns() {
    const dropdownIds = [
        'todoCategory', 'todoKpiType', 'todoAppName', 'todoPackage',
        'todoDirectManager', 'taskActionDepartmentFilter', 'taskActionUserSelect',
        'shareUserSelect', 'deptQueuePickerSelect', 'packageAssignUser',
        'userRole', 'userDepartment', 'userDriveAccessLevel',
        'teamFilterDepartment', 'todoFilterCategory', 'todoFilterScope',
        'todoFilterTeamMember', 'usersFilterRole', 'usersFilterDepartment'
    ];
    dropdownIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) makeSearchable(el);
    });
}

// ----------------------------------------------------------------
// CHECKBOX MULTI-SELECT DROPDOWN
// A custom dropdown with per-option checkboxes, no Ctrl required.
// Usage:
//   HTML: <div class="cms-checkbox-ms" data-select-id="mySelectId">
//           <div class="cms-checkbox-ms-trigger" onclick="toggleCheckboxMultiSelect('mySelectId')">...</div>
//           <div class="cms-checkbox-ms-panel">
//             <input class="cms-checkbox-ms-search" oninput="filterCheckboxMultiSelect('mySelectId', this.value)">
//             <div class="cms-checkbox-ms-options"></div>
//           </div>
//         </div>
//   JS: initCheckboxMultiSelect('mySelectId', 'Placeholder...')
// ----------------------------------------------------------------
const _checkboxMultiSelectInstances = new Map();

function initCheckboxMultiSelect(selectId, placeholder = 'Select...') {
    const select = document.getElementById(selectId);
    if (!select || select.tagName !== 'SELECT' || !select.multiple) return;

    const wrapper = document.querySelector(`.cms-checkbox-ms[data-select-id="${selectId}"]`);
    if (!wrapper) return;

    const trigger = wrapper.querySelector('.cms-checkbox-ms-trigger');
    const panel = wrapper.querySelector('.cms-checkbox-ms-panel');
    const search = wrapper.querySelector('.cms-checkbox-ms-search');
    const optionsEl = wrapper.querySelector('.cms-checkbox-ms-options');

    if (!trigger || !panel || !search || !optionsEl) return;

    if (!_checkboxMultiSelectInstances.has(selectId)) {
        _checkboxMultiSelectInstances.set(selectId, { select, wrapper, trigger, panel, search, optionsEl, placeholder });
        panel.addEventListener('click', (e) => e.stopPropagation());
        search.addEventListener('click', (e) => e.stopPropagation());
        wrapper.addEventListener('click', (e) => e.stopPropagation());
    } else {
        _checkboxMultiSelectInstances.get(selectId).placeholder = placeholder;
    }

    syncCheckboxMultiSelectFromSelect(selectId);

    if (!window.__cmsCheckboxMultiSelectGlobalListeners) {
        window.__cmsCheckboxMultiSelectGlobalListeners = true;
        document.addEventListener('click', () => closeAllCheckboxMultiSelects());
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllCheckboxMultiSelects(); });
    }
}

function toggleCheckboxMultiSelect(selectId) {
    if (!_checkboxMultiSelectInstances.has(selectId)) initCheckboxMultiSelect(selectId);
    const instance = _checkboxMultiSelectInstances.get(selectId);
    if (!instance) return;
    const isOpen = instance.panel.style.display !== 'none';
    if (isOpen) {
        closeCheckboxMultiSelect(selectId);
    } else {
        closeAllCheckboxMultiSelects(selectId);
        syncCheckboxMultiSelectFromSelect(selectId);
        instance.panel.style.display = 'block';
        instance.search.value = '';
        filterCheckboxMultiSelect(selectId, '');
        setTimeout(() => instance.search.focus(), 0);
    }
}

function closeCheckboxMultiSelect(selectId) {
    const inst = _checkboxMultiSelectInstances.get(selectId);
    if (inst) inst.panel.style.display = 'none';
}

function closeAllCheckboxMultiSelects(exceptSelectId = null) {
    for (const [id, inst] of _checkboxMultiSelectInstances.entries()) {
        if (exceptSelectId && id === exceptSelectId) continue;
        inst.panel.style.display = 'none';
    }
}

function syncCheckboxMultiSelectFromSelect(selectId) {
    const inst = _checkboxMultiSelectInstances.get(selectId);
    if (!inst) return;
    const { select, optionsEl } = inst;
    optionsEl.innerHTML = '';

    const options = Array.from(select.options);
    if (options.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cms-checkbox-ms-empty';
        empty.textContent = 'No options available';
        optionsEl.appendChild(empty);
        updateCheckboxMultiSelectTriggerText(selectId);
        return;
    }

    options.forEach((opt, idx) => {
        const row = document.createElement('label');
        row.className = 'cms-checkbox-ms-option';
        row.dataset.value = opt.value;
        row.dataset.text = (opt.textContent || '').toLowerCase();

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!opt.selected;
        cb.disabled = !!opt.disabled;
        cb.addEventListener('change', () => {
            select.options[idx].selected = cb.checked;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            updateCheckboxMultiSelectTriggerText(selectId);
        });

        const text = document.createElement('span');
        text.textContent = opt.textContent || opt.value;
        row.appendChild(cb);
        row.appendChild(text);
        optionsEl.appendChild(row);
    });

    updateCheckboxMultiSelectTriggerText(selectId);
}

function updateCheckboxMultiSelectTriggerText(selectId) {
    const inst = _checkboxMultiSelectInstances.get(selectId);
    if (!inst) return;
    const selected = Array.from(inst.select.selectedOptions)
        .map(o => (o.textContent || o.value || '').trim())
        .filter(Boolean);

    if (selected.length === 0) {
        inst.trigger.textContent = inst.placeholder || 'Select...';
        return;
    }
    const preview = selected.slice(0, 2).join(', ');
    inst.trigger.textContent = selected.length > 2 ? `${preview} +${selected.length - 2}` : preview;
}

function filterCheckboxMultiSelect(selectId, term) {
    const inst = _checkboxMultiSelectInstances.get(selectId);
    if (!inst) return;
    const lower = (term || '').toLowerCase().trim();
    let visible = 0;
    inst.optionsEl.querySelectorAll('.cms-checkbox-ms-option').forEach(row => {
        const hay = row.dataset.text || '';
        const match = !lower || hay.includes(lower);
        row.style.display = match ? 'flex' : 'none';
        if (match) visible++;
    });
    let empty = inst.optionsEl.querySelector('.cms-checkbox-ms-empty');
    if (!empty) {
        empty = document.createElement('div');
        empty.className = 'cms-checkbox-ms-empty';
        empty.textContent = 'No matches';
        empty.style.display = 'none';
        inst.optionsEl.appendChild(empty);
    }
    empty.style.display = visible === 0 ? 'block' : 'none';
}

// ----------------------------------------------------------------
// TOAST NOTIFICATION SYSTEM
// Usage: showToast('Message', 'success' | 'error' | 'info' | 'warning')
// ----------------------------------------------------------------
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.pointerEvents = 'auto';

    const icon = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' }[type] || 'ℹ️';

    toast.innerHTML = `
        <div class="toast-content" style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px;">
            <div style="display:flex;align-items:center;gap:12px;">
                <span class="toast-icon">${icon}</span>
                <span class="toast-message">${message}</span>
            </div>
            <button class="toast-close" onclick="this.parentElement.parentElement.remove()"
                style="background:none;border:none;color:inherit;cursor:pointer;padding:4px;opacity:0.7;font-size:16px;line-height:1;display:flex;align-items:center;transition:opacity 0.2s;"
                onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7">✕</button>
        </div>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('active'), 10);

    const autoRemove = setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.remove('active');
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);

    toast.querySelector('.toast-close').addEventListener('click', () => {
        clearTimeout(autoRemove);
        toast.remove();
    });
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    Object.assign(container.style, {
        position: 'fixed', top: '24px', right: '24px', zIndex: '99999',
        display: 'flex', flexDirection: 'column', gap: '12px',
        pointerEvents: 'none', width: 'auto', maxWidth: '400px'
    });
    document.body.appendChild(container);
    return container;
}

// ----------------------------------------------------------------
// GENERIC MODAL OPEN / CLOSE
// Usage: openModal('myModalId'), closeModal('myModalId')
// Works with any element that uses the .modal-backdrop class.
// ----------------------------------------------------------------
function openModal(id) {
    const el = document.getElementById(id);
    if (!el) { console.warn('Modal not found:', id); return; }
    el.classList.add('open');
    // Trap focus inside modal
    const firstFocusable = el.querySelector('input, textarea, select, button:not(.modal-close)');
    setTimeout(() => firstFocusable?.focus(), 50);
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
}

window.openModal  = openModal;
window.closeModal = closeModal;

// HTML escape helper (global safety net)
if (!window.escapeHtml) {
    window.escapeHtml = function(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };
}
