<script setup>
defineProps({
  text: {
    type: String,
    required: false,
    default: 'Применить'
  },
  prependIcon: {
    type: String,
    default: '',
  }
})

</script>

<template>
  <button class="base-button">
    <span v-if="prependIcon">
      <slot name="icon">
        <v-icon>{{ prependIcon }}</v-icon>
      </slot>
    </span>
    <slot name="default">
      {{ text }}
    </slot>
  </button>
</template>

<style scoped lang="scss">
.base-button {

}
</style>
