<template>
  <IonModal
    class="picker-modal"
    :is-open="isOpen"
    style="
      --height: 244px;
      --width: 100vw;
      --border-radius: 12px 12px 0 0;
      --fade-background-rgb: 5, 5, 5;
      align-items: flex-end;
      overflow: hidden;
    "
    @did-dismiss="emit('close')">
    <IonHeader>
      <IonToolbar>
        <IonButtons slot="start">
          <IonButton @click="emit('close')">cancel</IonButton>
        </IonButtons>
        <div class="channel-title">the channel</div>
        <IonButtons slot="end">
          <IonButton @click="confirm">done</IonButton>
        </IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent :scroll-y="false">
      <IonPicker>
        <IonPickerColumn :value="draftRoot" @ion-change="onRootChange">
          <IonPickerColumnOption :value="OPEN">open</IonPickerColumnOption>
          <IonPickerColumnOption v-for="(name, pc) in NOTE_NAMES" :key="pc" :value="pc">
            {{ name }}
          </IonPickerColumnOption>
        </IonPickerColumn>
        <IonPickerColumn :value="draftScale" @ion-change="onScaleChange">
          <IonPickerColumnOption
            v-for="scale in CHANNEL_SCALES"
            :key="scale.id"
            :value="scale.id"
            :style="{ opacity: draftRoot === OPEN ? 0.4 : 1 }">
            {{ scale.name }}
          </IonPickerColumnOption>
        </IonPickerColumn>
      </IonPicker>
    </IonContent>
  </IonModal>
</template>

<script setup lang="ts">
  // The Channel picker — Home's "the channel" row and SessionView's streams-header chip both
  // open this same drawer. Two columns like Logic's Scale Quantize: key root (with "open"
  // first = no lock) and scale. Works on a draft copy and only writes settingsStore on
  // "done", same cancel/done contract as the starting-notes picker, so cancelling never
  // leaves a half-changed lock behind.
  import { ref, watch } from 'vue'
  import {
    IonModal,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonContent,
    IonPicker,
    IonPickerColumn,
    IonPickerColumnOption,
  } from '@ionic/vue'
  import { useSettingsStore } from '../../stores/settingsStore'
  import { SCALES } from '../../data/scales'
  import { NOTE_NAMES } from '../../data/notes'

  const props = defineProps<{ isOpen: boolean }>()
  // 'confirm' fires after the store is updated, so a parent can react to the new lock
  // (SessionView regenerates stream candidates); 'close' fires on any dismissal.
  const emit = defineEmits<{ (e: 'close'): void; (e: 'confirm'): void }>()

  // "open" in the root column = no lock. Chromatic is excluded from the scale column — it
  // *is* the open state, not a separate choice.
  const OPEN = -1
  const CHANNEL_SCALES = SCALES.filter(s => s.id !== 'chromatic')

  const settingsStore = useSettingsStore()
  const draftRoot = ref<number>(OPEN)
  const draftScale = ref<string>(settingsStore.scaleId)

  watch(
    () => props.isOpen,
    open => {
      if (!open) return
      draftRoot.value = settingsStore.keyLocked ? settingsStore.keyRoot % 12 : OPEN
      draftScale.value = settingsStore.scaleId
    },
    { immediate: true }
  )

  function onRootChange(event: CustomEvent) {
    draftRoot.value = event.detail.value
  }
  function onScaleChange(event: CustomEvent) {
    draftScale.value = event.detail.value
  }

  function confirm() {
    settingsStore.setScaleId(draftScale.value)
    if (draftRoot.value === OPEN) {
      settingsStore.setKeyLocked(false)
    } else {
      settingsStore.setKeyRoot(60 + draftRoot.value)
      settingsStore.setKeyLocked(true)
    }
    emit('confirm')
    emit('close')
  }
</script>

<style scoped>
  .channel-title {
    text-align: center;
    font-size: var(--text-label);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
</style>
