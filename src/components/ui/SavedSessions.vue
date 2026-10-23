<template>
  <div class="saved-sessions">
    <p class="sheet-title">past flows</p>

    <ion-alert
      :is-open="showClearConfirm"
      header="clear all saved flows?"
      message="This can't be undone."
      :buttons="clearAlertButtons"
      @didDismiss="showClearConfirm = false" />

    <div class="sheet-group">
      <div class="sheet-label-row">
        <p class="sheet-label">saved sessions</p>
        <button v-if="sessions.length > 0" class="clear-all-btn" @click="showClearConfirm = true">
          clear all
        </button>
      </div>
      <div v-if="sessions.length === 0" class="empty-msg">
        no saved flows yet
      </div>
      <div v-else class="option-list session-list">
        <div v-for="s in sessions" :key="s.id" class="session-row">
          <!-- Name edit input -->
          <input
            v-if="editingId === s.id"
            :ref="
              (el) => {
                if (el) editInputs[s.id] = el as HTMLInputElement
              }
            "
            class="session-name-input"
            v-model="editName"
            @keydown.enter="commitRename(s.id)"
            @keydown.escape="cancelRename"
            @blur="commitRename(s.id)" />

          <!-- Normal row -->
          <template v-else>
            <button class="option-btn session-load-btn" @click="$emit('load', s)">
              <span class="session-name" @click.stop="startRename(s)">{{
                s.name
              }}</span>
              <span class="session-meta">
                {{ s.sequence.length }} clusters · {{ s.voiceCount }}v
                <ion-icon :icon="chevronForwardOutline" />
              </span>
            </button>
            <button class="row-edge-btn destructive" @click="remove(s.id)">
              <ion-icon :icon="trashOutline" />
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, onMounted, nextTick } from 'vue'
  import { IonIcon, IonAlert } from '@ionic/vue'
  import { chevronForwardOutline, trashOutline } from 'ionicons/icons'
  import {
    listSessions,
    deleteSession,
    clearAllSessions,
    renameSession,
    type SavedSession,
  } from '../../utils/sessionStorage'

  defineEmits<{ load: [session: SavedSession] }>()

  const sessions = ref<SavedSession[]>([])
  const editingId = ref<string | null>(null)
  const editName = ref('')
  const editInputs: Record<string, HTMLInputElement> = {}
  const showClearConfirm = ref(false)

  onMounted(() => {
    sessions.value = listSessions()
  })

  function remove(id: string) {
    deleteSession(id)
    sessions.value = listSessions()
  }

  function clearAll() {
    clearAllSessions()
    sessions.value = listSessions()
  }

  const clearAlertButtons = [
    { text: 'cancel', role: 'cancel' },
    { text: 'clear all', role: 'destructive', handler: clearAll },
  ]

  function startRename(s: SavedSession) {
    editingId.value = s.id
    editName.value = s.name
    nextTick(() => {
      editInputs[s.id]?.select()
    })
  }

  function commitRename(id: string) {
    if (editingId.value !== id) return
    const trimmed = editName.value.trim()
    if (trimmed) {
      renameSession(id, trimmed)
      sessions.value = listSessions()
    }
    editingId.value = null
  }

  function cancelRename() {
    editingId.value = null
  }
</script>

<style scoped>
  .saved-sessions {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .empty-msg {
    font-size: var(--text-sm);
    color: var(--color-text-dim);
    font-style: italic;
    padding: 1rem 0;
  }

  /* .sheet-label (typography) comes from sheets.css — this row just adds "clear all"
     as a right-aligned sibling without disturbing that shared rule */
  .sheet-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sheet-label-row .sheet-label {
    margin: 0;
  }

  .clear-all-btn {
    background: none;
    border: none;
    font-family: inherit;
    font-size: var(--text-label);
    letter-spacing: 0.1em;
    color: var(--color-text-dim);
    cursor: pointer;
    padding: 0.2rem 0;
    margin-bottom: 0.25rem;
  }
  .clear-all-btn:hover {
    color: var(--color-danger);
  }

  /* .option-list (box model) comes from sheets.css — session-row is a plain wrapper
     around two separate buttons (load + delete), so it keeps its own flex layout and
     divider rather than being an .option-btn itself */
  .session-row {
    display: flex;
    align-items: center;
    min-height: 48px;
  }
  .session-row + .session-row {
    border-top: 1px solid var(--color-border);
  }

  /* .option-btn (box model, touch target) comes from sheets.css */
  .session-load-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    gap: 0.5rem;
  }
  .session-load-btn:hover .session-name {
    color: var(--color-accent);
  }

  .session-name {
    font-size: var(--text-sm);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
    cursor: text;
    transition: color 0.15s;
  }

  .session-name-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--color-text);
    font-size: var(--text-sm);
    font-family: inherit;
    padding: 0.85rem 1rem;
    min-width: 0;
    width: 100%;
  }

  .session-meta {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    font-size: var(--text-xs);
    color: var(--color-text-dim);
    font-family: var(--font-mono);
    flex-shrink: 0;
    transition: color 0.15s;
  }
  .session-load-btn:hover .session-meta {
    color: var(--color-accent);
  }

  /* .row-edge-btn (box model, touch target) comes from theme/buttons.css */
</style>
