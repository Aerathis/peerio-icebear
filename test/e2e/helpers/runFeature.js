const { spawn } = require('child_process');
const Promise = require('bluebird');

const cucumberPath = 'node_modules/.bin/cucumber.js';
const supportCodePath = 'test/e2e/account/supportCode';

const getPeerioDataFrom = (output) => {
    const dataRegex = /<peerioData>.+<\/peerioData>/g;

    let found = output.match(dataRegex);
    found = found.map(x => x.replace('<peerioData>', ''));
    found = found.map(x => x.replace('</peerioData>', ''));

    const result = JSON.parse(found);
    return result;
};

const getScenarioSummary = (output) => {
    const dataRegex = /\d+ scenario(|s) \(.*\)/g;

    const found = output.match(dataRegex);
    return found;
};

const scenarioPassed = (output) => {
    const result = getScenarioSummary(output);
    return result && !result.includes('failed') && !result.includes('skipped');
};

const runFeature = (file, peerioData = null) => {
    return new Promise((resolve) => {
        let output = '';
        let errors = '';

        const options = [
            `test/e2e/helpers/${file}`,
            '-r',
            supportCodePath,
            '--compiler',
            'js:babel-register',
            '--require',
            'test/global-setup.js'
        ];

        const env = Object.create(process.env);
        env.peerioData = JSON.stringify(peerioData);

        const proc = spawn(cucumberPath, options, { env });

        proc.stdout.on('data', (data) => {
            process.stdout.write(data);
            output += data.toString();
        });

        proc.stderr.on('data', (data) => {
            process.stdout.write(data);
            errors += data.toString();
        });

        proc.on('close', () => {
            const result = {};
            result.succeeded = scenarioPassed(output);

            if (result.succeeded) {
                result.data = getPeerioDataFrom(output);
            }

            if (errors) {
                result.errors = errors;
            }

            resolve(result);
        });
    });
};

module.exports = runFeature;
