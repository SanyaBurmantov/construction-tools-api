// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
    rules: {
        // Отключаем требование многословных имен компонентов
        'vue/multi-word-component-names': 'off',

        // Предупреждаем о неиспользуемых переменных
        'no-unused-vars': 'warn',

        // Разрешаем console.log в разработке, но предупреждаем
        'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',

        // Более строгие правила для TypeScript
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-vars': 'warn',

        // Vue правила
        'vue/no-unused-vars': 'warn',
        'vue/require-default-prop': 'off',

    }
})
