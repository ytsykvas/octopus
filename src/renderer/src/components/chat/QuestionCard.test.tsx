import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ASK_USER_QUESTION, readQuestions, type UserQuestions } from '@core/questions.js'

import { QuestionCard } from './QuestionCard.js'

/** Parsed rather than written by hand, so the fixture is a call the agent makes. */
function asked(input: unknown): UserQuestions {
  const parsed = readQuestions(ASK_USER_QUESTION, input)
  if (!parsed) throw new Error('the fixture should parse')
  return parsed
}

const ONE_QUESTION = asked({
  questions: [
    {
      question: 'Which library should we use?',
      header: 'Library',
      multiSelect: false,
      options: [
        { label: 'date-fns', description: 'Tree-shakeable' },
        { label: 'Luxon', description: 'Carries its own time zones' }
      ]
    }
  ]
})

function renderCard(overrides: Partial<React.ComponentProps<typeof QuestionCard>> = {}): {
  onAnswer: ReturnType<typeof vi.fn>
  onSkip: ReturnType<typeof vi.fn>
} {
  const onAnswer = vi.fn()
  const onSkip = vi.fn()

  render(
    <QuestionCard
      questions={ONE_QUESTION}
      answerable
      answered={null}
      onAnswer={onAnswer}
      onSkip={onSkip}
      {...overrides}
    />
  )

  return { onAnswer, onSkip }
}

const send = (): HTMLElement => screen.getByRole('button', { name: 'Answer' })

describe('a question the agent asked', () => {
  it('shows the question, its chip and what each option means', () => {
    renderCard()

    expect(screen.getByText('Which library should we use?')).toBeVisible()
    expect(screen.getByText('Library')).toBeVisible()
    expect(screen.getByText('date-fns')).toBeVisible()
    expect(screen.getByText(/Carries its own time zones/)).toBeVisible()
  })

  it('sends the option that was chosen, keyed by the question', async () => {
    const user = userEvent.setup()
    const { onAnswer } = renderCard()

    await user.click(screen.getByRole('radio', { name: /Luxon/ }))
    await user.click(send())

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([
      { question: 'Which library should we use?', selected: ['Luxon'], other: null }
    ])
  })

  // Nothing to send is not an answer, and the tool would read an empty one as
  // an answer that says nothing.
  it('will not send until something is chosen', async () => {
    const user = userEvent.setup()
    renderCard()

    expect(send()).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: /date-fns/ }))
    expect(send()).toBeEnabled()
  })

  /*
   * The tool's own affordance. It runs with its arguments untouched, and the
   * agent reads that as "nobody answered" — its cue to ask again rather than to
   * guess.
   */
  it('offers a way past without answering', async () => {
    const user = userEvent.setup()
    const { onSkip, onAnswer } = renderCard()

    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(onSkip).toHaveBeenCalledOnce()
    expect(onAnswer).not.toHaveBeenCalled()
  })

  /*
   * The question and its options are the agent's text, and this card is
   * answered rather than merely read — an override reordering an option's
   * label makes somebody choose one thing while another is sent back. The
   * label itself stays raw: it is the key and the answer, and only what is
   * drawn is substituted.
   */
  /*
   * Every string on this card is the agent's, and the card is answered rather
   * than merely read: an override reordering an option makes somebody choose
   * one thing while another is sent back.
   *
   * All four in one test on purpose. `shown` returns ordinary text untouched,
   * so wrapping a string in it adds no branch and coverage stays at 100%
   * whether the call is there or not — only an assertion stops one being
   * dropped again.
   *
   * The label keeps its raw form as the key and as the answer. Only what is
   * drawn is substituted, which is what the round trip below checks.
   */
  it('names a character anywhere in a question that would not draw as itself', async () => {
    const user = userEvent.setup()
    const { onAnswer } = renderCard({
      questions: asked({
        questions: [
          {
            question: 'which \u202Eeno?',
            header: 'a \u202Epeder',
            multiSelect: false,
            options: [
              { label: 'safe \u202Eesrever', description: 'looks \u202Eenif' },
              { label: 'other', description: 'two' }
            ]
          }
        ]
      })
    })

    expect(screen.getAllByText('U+202E')).toHaveLength(4)

    await user.click(screen.getByRole('radio', { name: /esrever/ }))
    await user.click(send())

    expect(onAnswer).toHaveBeenCalledWith([
      { question: 'which \u202Eeno?', selected: ['safe \u202Eesrever'], other: null }
    ])
  })

  describe('choosing one of several', () => {
    it('replaces the previous choice', async () => {
      const user = userEvent.setup()
      const { onAnswer } = renderCard()

      await user.click(screen.getByRole('radio', { name: /date-fns/ }))
      await user.click(screen.getByRole('radio', { name: /Luxon/ }))
      await user.click(send())

      expect(onAnswer).toHaveBeenCalledExactlyOnceWith([
        { question: 'Which library should we use?', selected: ['Luxon'], other: null }
      ])
    })

    it('accumulates when the agent said several are allowed', async () => {
      const user = userEvent.setup()
      const { onAnswer } = renderCard({
        questions: asked({
          questions: [
            {
              question: 'Which features do you want?',
              multiSelect: true,
              options: [{ label: 'Search' }, { label: 'Export' }, { label: 'Sync' }]
            }
          ]
        })
      })

      await user.click(screen.getByRole('checkbox', { name: /Search/ }))
      await user.click(screen.getByRole('checkbox', { name: /Sync/ }))
      await user.click(send())

      expect(onAnswer).toHaveBeenCalledExactlyOnceWith([
        { question: 'Which features do you want?', selected: ['Search', 'Sync'], other: null }
      ])
    })

    // And un-ticks, which is the other half of what a checkbox promises.
    it('takes a choice back when it is clicked again', async () => {
      const user = userEvent.setup()
      const { onAnswer } = renderCard({
        questions: asked({
          questions: [
            {
              question: 'Which features do you want?',
              multiSelect: true,
              options: [{ label: 'Search' }, { label: 'Export' }]
            }
          ]
        })
      })

      await user.click(screen.getByRole('checkbox', { name: /Search/ }))
      await user.click(screen.getByRole('checkbox', { name: /Export/ }))
      await user.click(screen.getByRole('checkbox', { name: /Search/ }))
      await user.click(send())

      expect(onAnswer).toHaveBeenCalledExactlyOnceWith([
        { question: 'Which features do you want?', selected: ['Export'], other: null }
      ])
    })
  })

  /*
   * The tool's schema says an "other" choice is never among the options and the
   * host is to provide one — so the card owes the user a way to say something
   * the agent did not think of.
   */
  describe('answering with something else', () => {
    it('opens a field and sends what was written in it', async () => {
      const user = userEvent.setup()
      const { onAnswer } = renderCard()

      await user.click(screen.getByRole('radio', { name: 'Something else' }))
      await user.type(screen.getByLabelText('Write your own answer'), 'neither, write it by hand')
      await user.click(send())

      expect(onAnswer).toHaveBeenCalledExactlyOnceWith([
        {
          question: 'Which library should we use?',
          selected: [],
          other: 'neither, write it by hand'
        }
      ])
    })

    // In a single-answer question they are alternatives, not additions.
    it('puts away the option that was ticked', async () => {
      const user = userEvent.setup()
      const { onAnswer } = renderCard()

      await user.click(screen.getByRole('radio', { name: /Luxon/ }))
      await user.click(screen.getByRole('radio', { name: 'Something else' }))
      await user.type(screen.getByLabelText('Write your own answer'), 'something better')
      await user.click(send())

      expect(onAnswer).toHaveBeenCalledExactlyOnceWith([
        { question: 'Which library should we use?', selected: [], other: 'something better' }
      ])
    })

    // Where several answers are allowed it is an addition rather than an
    // alternative, so what was ticked stays ticked.
    it('joins the other choices when several are allowed', async () => {
      const user = userEvent.setup()
      const { onAnswer } = renderCard({
        questions: asked({
          questions: [
            {
              question: 'Which features do you want?',
              multiSelect: true,
              options: [{ label: 'Search' }, { label: 'Export' }]
            }
          ]
        })
      })

      await user.click(screen.getByRole('checkbox', { name: /Search/ }))
      await user.click(screen.getByRole('checkbox', { name: 'Something else' }))
      await user.type(screen.getByLabelText('Write your own answer'), 'and offline mode')
      await user.click(send())

      expect(onAnswer).toHaveBeenCalledExactlyOnceWith([
        {
          question: 'Which features do you want?',
          selected: ['Search'],
          other: 'and offline mode'
        }
      ])
    })

    /*
     * Un-ticking puts the field away and forgets what was in it — the user said
     * they did not want to write their own answer after all.
     *
     * Only reachable where several answers are allowed: a radio cannot be
     * un-ticked by clicking it again, so in a single-answer question the way
     * out of "something else" is to pick one of the options.
     */
    it('closes the field when it is un-ticked', async () => {
      const user = userEvent.setup()
      renderCard({
        questions: asked({
          questions: [
            {
              question: 'Which features do you want?',
              multiSelect: true,
              options: [{ label: 'Search' }, { label: 'Export' }]
            }
          ]
        })
      })

      await user.click(screen.getByRole('checkbox', { name: 'Something else' }))
      await user.type(screen.getByLabelText('Write your own answer'), 'never mind')
      await user.click(screen.getByRole('checkbox', { name: 'Something else' }))

      expect(screen.queryByLabelText('Write your own answer')).not.toBeInTheDocument()
      expect(send()).toBeDisabled()
    })

    // Emptiness cannot stand for "not ticked": someone who ticks it and deletes
    // what they typed has not untied it, and the field vanishing under them
    // would be the field fighting back.
    it('leaves the field open when everything in it is deleted', async () => {
      const user = userEvent.setup()
      renderCard()

      await user.click(screen.getByRole('radio', { name: 'Something else' }))
      await user.type(screen.getByLabelText('Write your own answer'), 'a')
      await user.clear(screen.getByLabelText('Write your own answer'))

      expect(screen.getByLabelText('Write your own answer')).toBeVisible()
      expect(send()).toBeDisabled()
    })
  })

  /*
   * Previews exist to be compared while choosing, which is why they follow the
   * pointer rather than the selection: four mock-ups open at once is a wall
   * rather than a comparison.
   */
  describe('the preview of an option', () => {
    const withPreviews = asked({
      questions: [
        {
          question: 'Which layout?',
          options: [
            { label: 'Split', preview: 'left | right' },
            { label: 'Stacked', preview: 'top over bottom' }
          ]
        }
      ]
    })

    it('shows nothing until an option is looked at', () => {
      renderCard({ questions: withPreviews })

      expect(screen.queryByText('left | right')).not.toBeInTheDocument()
    })

    it('shows the one the pointer is over, and only that one', async () => {
      const user = userEvent.setup()
      renderCard({ questions: withPreviews })

      await user.hover(screen.getByText('Split'))

      expect(screen.getByText('left | right')).toBeVisible()
      expect(screen.queryByText('top over bottom')).not.toBeInTheDocument()
    })

    it('follows the keyboard as well as the pointer', async () => {
      const user = userEvent.setup()
      renderCard({ questions: withPreviews })

      await user.tab()

      expect(screen.getByText('left | right')).toBeVisible()
    })
  })

  /*
   * Read back from the transcript, where the card is a record of itself. This
   * is the whole reason the answer is written down: the tool call above holds
   * the questions as they were before anyone answered.
   */
  describe('a question already answered', () => {
    it('shows what was chosen, and offers no way to change it', () => {
      renderCard({
        answerable: false,
        answered: [{ question: 'Which library should we use?', selected: ['Luxon'], other: null }]
      })

      expect(screen.getByRole('radio', { name: /Luxon/ })).toBeChecked()
      expect(screen.getByRole('radio', { name: /Luxon/ })).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Answer' })).not.toBeInTheDocument()
      expect(screen.getByText('Answered.')).toBeVisible()
    })

    it('shows what was written when the answer was not one of the options', () => {
      renderCard({
        answerable: false,
        answered: [
          { question: 'Which library should we use?', selected: [], other: 'wrote it by hand' }
        ]
      })

      expect(screen.getByLabelText('Write your own answer')).toHaveValue('wrote it by hand')
    })

    // The turn ended — stopped, or the session closed — while the question was
    // still on screen. Saying so is the truth, and it is not the same as saying
    // it was answered.
    it('says so when the question was never answered at all', () => {
      renderCard({ answerable: false, answered: null })

      expect(screen.getByText('Left unanswered.')).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
    })
  })
})
