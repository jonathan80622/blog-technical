Feature: Evidence-backed AI trends among startup candidates
  The product goal is to understand which AI technologies startups are investing
  engineering effort in. VC portfolios are a candidate-discovery heuristic only.
  Hiring demand and demonstrated technical use are separate signal kinds.

  # These scenarios describe product behaviour. Transport, framework, queue,
  # and persistence details belong in the traceability register and supporting
  # tests, not in this feature.

  Background:
    Given the application page is open

  @runtime
  Scenario: Dispatch VC discovery in local mode
    Given the application is operating locally
    And a prepared VC discovery job is leased
    When discovery work is started
    Then the prepared job is claimed once
    And it starts the shared discovery workflow directly
    And no separate delivery service is required

  @runtime
  Scenario: Dispatch VC discovery in hosted mode
    Given the application is operating in its hosted environment
    And a prepared VC discovery job is leased
    When discovery work is started
    Then the job is handed to the hosted delivery service
    And the delivery service claims the job before starting the shared discovery workflow

  @ui @current-contract
  Scenario: Load and refresh the shared overview
    When the page loads
    And the page shows a loading state until the response is available
    And the default view is "AI Trends"
    When I select the "Companies" navigation button
    Then the page refreshes its shared research records
    And it shows the Companies view using those refreshed records

  @ui @current-contract
  Scenario: Show accepted trend evidence with distinct company counts
    Given the overview contains accepted AI signal claims for one company in both hiring and technical sources
    And a second company has an accepted hiring signal for the same trend
    When the AI Trends view is rendered
    Then the trend shows 2 distinct companies
    And it shows 2 hiring companies and 1 technical-use company
    And it shows each supporting passage, company, source kind, and source link
    And it shows capture dates and publication dates or "Publication date unknown"
    And the page says the counts are scoped to the selected startup sample
    And it shows the promoted-candidate denominator and separate technical/hiring coverage outcomes
    But it does not describe portfolio membership as proof of growth or AI investment
    And it does not claim spend, market share, or trend acceleration

  @ui @empty @current-contract
  Scenario: Explain why there are no trend cards
    Given the overview contains no accepted AI signals
    When the AI Trends view is rendered
    Then the page says "No accepted AI signals yet"
    And it directs me to collect company hiring and technical sources and review claims

  @ui @failure @current-contract
  Scenario: Make overview failure visible
    Given shared research records cannot be loaded
    When the page loads or I select a navigation button
    Then the page displays an availability notice
    And it does not present unavailable records as fresh data

  @ui @current-contract
  Scenario: Navigate to research without implying it has started
    When I click "Request research"
    Then the Collection view appears
    And no collection work is started

  @ui @mobile @current-contract
  Scenario: Keep Collection controls usable on a phone viewport
    Given the browser viewport is 390 pixels wide
    When I open Collection and dispatch one prepared VC
    Then the dispatch button is visible and usable
    And one prepared discovery candidate is started
    And the page displays how much work started

  @ui @current-contract
  Scenario: Distinguish investor portfolio discovery from funding evidence
    Given an investor has evidence-backed portfolio relationships
    When I open Investors
    Then I see the investor rationale and portfolio-link count
    And the page describes portfolio membership separately from funding-round participation
    When I open Companies
    Then I see promoted companies and any recorded funding round
    And an unresolved domain or missing round is not presented as a negative fact

  @ui @empty @current-contract
  Scenario: Explain an empty promoted-company list
    Given there are no promoted companies
    When I open Companies
    Then the page says no companies are promoted yet
    And it directs me to collect and review a portfolio source first

  @ui @current-contract
  Scenario: Show only recorded coverage outcomes
    Given coverage checks exist for some company and task pairs
    When I open Coverage
    Then I see outcome totals and company, task, outcome rows from the overview response
    And an unrecorded check is not represented as a failed search
    But the current Coverage rows do not open a detail record or start work

  @ui @current-contract
  Scenario: Accept a supported AI signal
    Given a candidate AI signal has exact evidence from its matching company's matching source kind
    When I click "Accept" on that claim
    Then the claim is submitted for acceptance
    And the claim shows "Saving review…" while the request is pending
    And after success the claim is shown as accepted
    When the overview is refreshed
    Then the accepted signal contributes to the trend count once for its company

  @ui @current-contract
  Scenario: Reject a candidate so it does not contribute to trends
    Given a candidate AI signal is visible in Claims
    When I click "Reject" on that claim
    Then the claim is submitted for rejection
    And the claim shows "Saving review…" while the request is pending
    And after success the claim is shown as rejected
    When the overview is refreshed
    Then the rejected claim is absent from accepted trend totals

  @ui @failure @current-contract
  Scenario: Keep claim review failure visible without optimistic acceptance
    Given the claim review cannot be saved
    When I click "Accept" or "Reject"
    Then a review error is shown as an alert
    And the local claim status does not change
    And a failed AI acceptance cannot enter trend totals

  @ui @current-contract
  Scenario: Open source evidence from Claims and Sources
    Given a claim has an evidence passage and canonical source URL
    When I activate its source link
    Then the original URL opens in a new tab
    When I open Sources
    Then I see collected company source URLs and types
    But the current Sources view does not display stored document versions or snapshots

  @ui @empty @current-contract
  Scenario: Explain an empty source list
    Given no company sources have been collected
    When I open Sources
    Then the page says "No company sources have been collected"

  @ui @current-contract
  Scenario: Dispatch five prepared VC candidates
    Given prepared market-map discovery jobs exist
    When I click "Dispatch next 5 prepared VCs"
    Then up to five prepared candidates are started
    And the control is disabled while dispatch is pending
    And the dispatcher leases eligible jobs within the active-capacity limit
    And successful handoffs are recorded and reported as started
    And no candidate is described as a high-growth company solely because it is on a portfolio page

  @ui @current-contract
  Scenario: Dispatch one prepared VC candidate
    Given prepared market-map discovery jobs exist
    When I click "Dispatch 1 prepared VC"
    Then one prepared candidate is started
    And successful handoff is reported as started

  @ui @empty @current-contract
  Scenario Outline: Explain why no VC jobs were dispatched
    Given there are <pending> pending or failed jobs and <active> active jobs
    And the configured active capacity is <capacity>
    When I dispatch prepared VCs
    Then the product explains <reason>
    Examples:
      | pending | active | capacity | reason |
      | 0 | 0 | 5 | no market-map jobs are prepared |
      | 0 | 2 | 5 | all available discovery work is already in progress |
      | 3 | 5 | 5 | all discovery slots are active |

  @ui @failure @current-contract
  Scenario: Show queue publication failure
    Given queue publication fails for all leased candidates
    When I click a VC dispatch control
    Then the response is an error
    And the UI shows the dispatch error as an alert
    And failed publication returns the affected job to pending for a later dispatch

  @ui @failure @current-contract
  Scenario: Explain when failed publication cannot be compensated
    Given queue publication fails and returning a job to pending also fails
    When starting discovery work cannot be confirmed
    Then the alert says a job may still require repair
    And it directs me to check the queue monitor before retrying

  @ui @failure @current-contract
  Scenario: Show partial queue publication failure
    Given dispatch publishes some jobs and fails to publish others
    When the dispatch request returns a partial result
    Then the page shows the queued and failed counts as an alert
    And it says failed jobs were returned to pending where possible
    And it reports when any failed job could not be returned to pending

  @failure @current-contract
  Scenario: Preserve a queue-accepted job when outbox tracking fails
    Given queue publication succeeds but updating the outbox record fails
    When discovery work has been accepted
    Then the product reports that tracking needs attention
    And it does not restart the accepted work
    And the accepted work can still continue

  @ui @current-contract
  Scenario: Monitor VC jobs and explicitly replay a zero-promotion result
    Given a completed VC job promoted zero evidence-backed companies
    When the VC queue monitor refreshes
    Then the job state, attempts, progress, counts, and capacity are visible
    And the job has a "Replay 0-promotion result" control
    When I click that control
    Then the job is prepared for another attempt without starting automatically
    And the UI tells me to dispatch one VC to start it

  @ui @failure @current-contract
  Scenario: Reject replay for any other VC job state
    Given a VC job is not a succeeded zero-promotion result
    When a replay request is submitted for that job
    Then the product explains that it cannot be replayed
    And the job is not changed

  @ui @failure @current-contract
  Scenario: Make queue monitor errors visible
    Given discovery progress cannot be loaded
    When the monitor polls
    Then the page shows a queue alert and an unavailable/retrying state

  @ui @current-contract
  Scenario Outline: Submit an official-domain research source
    Given the relevant company or investor has a verified official domain
    When I choose source type "<kind>" and enter an HTTPS URL on that verified domain
    And I click "Start research"
    And the button says "Submitting…" while pending
    And successful submission starts collection work
    And the page displays the accepted collection reference
    And the URL field is cleared
    And if the kind is "VC_PORTFOLIO", exact company passages and official links are validated before promoting candidates
    Examples:
      | kind |
      | TECHNICAL_BLOG |
      | HIRING_POSTING |
      | VC_PORTFOLIO |

  @failure @current-contract
  Scenario: Refuse unsupported direct company evidence
    Given no discovered company has the URL's official domain
    When the researcher submits a technical blog or hiring posting on that domain
    Then the product explains why the source cannot be collected
    And it does not report collection as accepted

  @failure @current-contract
  Scenario: Refuse direct portfolio collection for an unverified investor domain
    Given no investor has a verified domain matching the portfolio URL
    When the researcher submits that portfolio source
    Then the product explains why the source cannot be collected
    And it does not report collection as accepted

  @ui @failure @current-contract
  Scenario: Show source submission validation or dispatch failure
    Given source submission cannot be accepted
    When I submit the source form
    Then the form displays the returned error as an alert
    And it does not claim that collection was accepted

  @security @failure @current-contract
  Scenario: Refuse source collection to private network destinations
    Given a source URL uses a private IP, local hostname, or nonstandard HTTPS port
    When the researcher submits that source
    Then the product refuses it before collection begins

  @security @failure @current-contract
  Scenario: Revalidate DNS and redirects before fetching source content
    Given a public source hostname redirects outside its verified domain or to a private address
    When the collection workflow follows the redirect
    Then it rejects the destination before making a request to it
    And the source run records a failed collection attempt

  @ui @current-contract
  Scenario: Monitor durable source collection and retries
    Given source runs exist
    When the run monitor refreshes
    Then source state, stage, attempts, retry time, and latest recorded event are displayed
    And the monitor refreshes on its polling interval

  @ui @empty @current-contract
  Scenario: Explain that there are no direct research runs
    Given there are no direct research runs
    When the run monitor renders
    Then the page says "No research runs yet"

  @ui @failure @current-contract
  Scenario: Make source run monitor failure visible
    Given source-run records cannot be loaded
    When the run monitor polls
    Then it shows a run-monitor alert
    And it says run records are unavailable and will be retried

  @ui @gap
  Scenario: Do not imply Chat is connected to its backend
    When I open Chat
    Then the page says Chat is not implemented
    And no question input is available
    And no answer is requested
    But the service can later support grounded answers when the product exposes it

  @gap
  Scenario: Make coverage and high-growth qualification auditable
    Given accepted AI trend counts are displayed
    Then the product needs an explicit company coverage denominator and task scope beside those counts
    And the product needs a defined evidence-backed high-growth eligibility rule before claiming the sample is high growth
    And the product must not infer either fact from portfolio membership
