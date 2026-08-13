# omp-session-progress

Oh My Pi extension that periodically shows a short recap of an active coding session above the editor.

The panel appears only after relevant session activity, disappears when a new prompt invalidates it, and returns on the next scheduled recap. Press `Esc` to close it.

## Install

Install it from GitHub:

```sh
omp plugin install github:kalugny/omp-session-progress
```

Restart Oh My Pi after installing.

## Configure

Recaps run every four minutes by default. Change the interval with the extension flag:

```sh
omp --session-progress-minutes 2
```

The value must be a positive number.

## License

[MIT](LICENSE)
