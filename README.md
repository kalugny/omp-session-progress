# omp-session-progress

Oh My Pi extension that periodically shows a short recap of an active coding session above the editor.

The panel appears only after relevant session activity, disappears when a new prompt invalidates it, and returns on the next scheduled recap. Press `Esc` to close it.

## Install

Clone the repository into your Oh My Pi extensions directory:

```sh
git clone https://github.com/kalugny/omp-session-progress ~/.omp/agent/extensions/omp-session-progress
```

Restart Oh My Pi after installing.

## Configure

Recaps run every four minutes by default. Change **Session progress minutes** in `/settings`, or pass the flag directly:

```sh
omp --session-progress-minutes 2
```

The value must be a positive number.

## License

[MIT](LICENSE)
