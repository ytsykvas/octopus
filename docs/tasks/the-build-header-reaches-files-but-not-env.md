# The Build header reaches Files but not Env

`Edit files` on the Build heading opens the project dialog on its `Files`
section. The comment beside it gives the reason it exists at all:

> The env is the thing a build most often turns out to be lacking, and by then
> the empty state that held this button is long gone.

That reason now points at a section the button cannot reach. `Files` is a list
of paths copied out of the checkout; the variables moved to `Env` beside it, and
for a project cloned from GitHub the paths answer nothing — nothing gitignored
was ever on GitHub to clone, so `Files` is empty of use and `Env` is the whole
answer.

So the one button on the header leads to the half that helps least, for the
projects most likely to be missing something.

Three ways out, none obviously right:

- **Point it at `Env` and rename it.** One button still, leading to what the
  comment says it is for. Costs quick access to the file list, which is one
  click away in the dialog's rail.
- **Two buttons.** Honest, and the header already refuses this shape: two
  controls on it would be two names where the fold control already needs its
  own aria label to stay unambiguous.
- **Leave it.** The rail is right there, and anyone who opens the dialog sees
  both sections.

Worth deciding when the header is next touched, rather than on its own.
