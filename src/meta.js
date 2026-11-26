'use strict';
// The fixed vocabulary of the board. Areas are per project.
const list = pairs => pairs.map(([id, name, hint]) => ({ id, name, hint }));

module.exports = {
  STATUSES: list([
    ['todo', 'To Do', 'Known, not started'],
    ['doing', 'In Progress', 'Being worked on'],
    ['blocked', 'Blocked', 'Waiting on something outside the code, or on a decision'],
    ['fixed', 'Fixed', 'Changed locally, not committed'],
    ['pushed', 'Pushed', 'Committed and pushed, not live'],
    ['deployed', 'Deployed', 'Live'],
    ['wontfix', "Won't Do", 'Decided against']
  ]),
  TYPES: list([['bug', 'Bug'], ['security', 'Security'], ['feature', 'Feature'], ['improvement', 'Improvement'], ['task', 'Task'], ['test', 'To Verify'], ['chore', 'Cleanup']]),
  PRIORITIES: list([['P1', 'Critical'], ['P2', 'High'], ['P3', 'Medium'], ['P4', 'Low']]),
  COLORS: ['rose', 'violet', 'blue', 'teal', 'green', 'amber', 'orange', 'slate'],
  DEFAULT_AREAS: ['UI', 'API', 'Data', 'Operations']
};
