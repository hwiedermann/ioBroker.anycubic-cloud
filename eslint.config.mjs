import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        ignores: ['build/', 'test/', 'admin/words.js', '.dev-server/'],
    },
    {
        // Diese Doku-/Stilregeln bewusst gelockert (kleiner, gut kommentierter Adapter):
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns': 'off',
            'jsdoc/require-returns-description': 'off',
            'jsdoc/no-blank-blocks': 'off',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-namespace': 'off',
        },
    },
];
