import copyIcon from "../icons/copy.svg";
import { CardView, type CardTone } from "../components/CardView";
import { Chip } from "../components/Chip";
import { Lane } from "../components/Lane";
import { StageStepper } from "../components/StageStepper";
import { ThesisGroup } from "../components/ThesisGroup";

/**
 * Static gallery that mirrors Figma frame 3:2 (D1 / 02 Flow) and components 2:86 / 2:10,
 * for side-by-side visual comparison (`/dev/gallery`). Not linked from the app.
 */
type C = { id: string; title: string; tone: CardTone; points?: string[]; tags?: boolean };

const lanes: { id: string; label: string; title: string; min: number; side: string; ours: boolean; cards: C[] }[] = [
  {
    id: "PMC",
    label: "PMC",
    title: "Prime Minister Constructive",
    min: 7,
    side: "Gov",
    ours: false,
    cards: [
      { id: "G1", title: "Segregation of elite networks", tone: "neutral", points: ["7% of pupils, 40%+ of top jobs", "Social capital compounds over generations"] },
      { id: "G2", title: "Brain drain from public schools", tone: "neutral", points: ["State schools lose their loudest advocates"] },
      { id: "G3", title: "Equal opportunity is a state duty", tone: "red" },
      { id: "G4", title: "Model: 5-year phase-out", tone: "neutral" },
    ],
  },
  {
    id: "LOC",
    label: "LOC",
    title: "Leader of Opposition Constructive",
    min: 8,
    side: "Opp",
    ours: true,
    cards: [
      { id: "O2", title: "Elites exit anyway", tone: "ours", points: ["Ban moves segregation, doesn’t end it"] },
      { id: "O3", title: "Private schools subsidise the state", tone: "ours", points: ["≈ £3.5bn/yr shifted onto public budgets"] },
      { id: "O1", title: "Parental liberty", tone: "ours", points: ["A state monopoly on values is dangerous", "Faith and specialist schools vanish"] },
      { id: "O4", title: "Model is unworkable", tone: "ours" },
    ],
  },
  {
    id: "MGC",
    label: "MGC",
    title: "Member of Government Constructive",
    min: 8,
    side: "Gov",
    ours: false,
    cards: [
      { id: "G5", title: "Tutoring ≠ school networks", tone: "neutral", points: ["Rebuilds G1 against O2"] },
      { id: "G7", title: "Funding follows pupils", tone: "neutral" },
      { id: "G6", title: "Liberty ≠ buying advantage", tone: "red", points: ["Concedes O1’s principle, contests scope"] },
      { id: "G8", title: "Elites will fix state schools", tone: "red", tags: true },
    ],
  },
  {
    id: "MOC",
    label: "MOC",
    title: "Member of Opposition Constructive",
    min: 8,
    side: "Opp",
    ours: true,
    cards: [
      { id: "M1", title: "Networks form later", tone: "ours", points: ["Oxbridge and firms are the real gatekeepers"] },
      { id: "M2", title: "Transition hits the poorest", tone: "ours" },
    ],
  },
];

function CardDemo({ c, expanded = true }: { c: C; expanded?: boolean }) {
  const num = c.id.replace(/\D/g, "");
  return (
    <CardView
      tone={c.tone}
      label={c.id}
      text={c.title}
      expanded={expanded}
      points={(c.points ?? []).map((t, i) => ({ id: `${c.id}-${i}`, label: `${num}${"ab"[i]}`, text: t }))}
      tags={
        c.tags ? (
          <>
            <Chip label="Doesn't make sense" />
            <Chip label="No warrant" />
            <Chip label="Non-responsive" />
            <Chip label="Concede" />
            <Chip label="POO" tone="alert" />
          </>
        ) : undefined
      }
    />
  );
}

export function Gallery() {
  return (
    <div className="app" style={{ height: 900, width: 1440 }} data-testid="gallery">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">D</span>
          <span className="brand__name">Debatable</span>
        </div>
        <span className="topbar__slash">/</span>
        <span className="topbar__motion">THW ban private schools</span>
        <span className="topbar__spacer" />
        <span className="side-pill">
          <span className="side-pill__side">Opposition</span>
          <span className="side-pill__dot">·</span>
          <span className="side-pill__rest">You: MO · Partner: Priya (LO)</span>
        </span>
        <span className="code-pill">
          <span className="code-pill__code">K7F-29Q</span>
          <img src={copyIcon} width={14} height={14} alt="" />
        </span>
        <button className="btn btn--dark" type="button">
          End round
        </button>
      </header>
      <div className="stagebar">
        <StageStepper
          steps={[
            { id: "PMC", label: "PMC", state: "done" },
            { id: "LOC", label: "LOC", state: "done" },
            { id: "MGC", label: "MGC", state: "done" },
            { id: "MOC", label: "MOC", state: "current" },
            { id: "LOR", label: "LOR", state: "future" },
            { id: "PMR", label: "PMR", state: "future" },
          ]}
        />
        <span className="stagebar__spacer" />
      </div>
      <div className="app__body">
        <div style={{ width: 48, background: "#fff", borderRight: "1px solid var(--c-border)" }} />
        <main className="board">
          <div className="lanes">
            {lanes.map((l) => (
              <Lane
                key={l.id}
                speechId={l.id}
                label={l.label}
                title={l.title}
                minutes={l.min}
                sideTag={l.side}
                ours={l.ours}
                live={l.id === "MOC"}
                future={false}
              >
                {l.cards.map((c) => (
                  <CardDemo key={c.id} c={c} />
                ))}
              </Lane>
            ))}
            <Lane speechId="LOR" label="LOR" title="Leader of Opposition Rebuttal" minutes={4} sideTag="Opp" ours live={false} future />
            <Lane speechId="PMR" label="PMR" title="Prime Minister Rebuttal" minutes={5} sideTag="Gov" ours={false} live={false} future />
          </div>
        </main>
      </div>
      <section style={{ padding: 20, display: "flex", gap: 40, background: "#fff" }} data-testid="gallery-components">
        <div data-testid="gallery-cards" style={{ display: "flex", gap: 40, padding: 16, width: 778 }}>
          {(["ours", "red", "neutral"] as CardTone[]).map((tone) => (
            <div key={tone} style={{ width: 232 }}>
              <CardView
                tone={tone}
                label="G1"
                text="Segregation of elite networks"
                expanded
                points={[
                  { id: "a", label: "1a", text: "7% of students, 40%+ of top jobs" },
                  { id: "b", label: "1b", text: "Social capital compounds across generations" },
                ]}
              />
            </div>
          ))}
        </div>
        <div data-testid="gallery-chips" style={{ display: "flex", gap: 8, padding: 16, alignItems: "center" }}>
          <Chip label="No warrant" />
          <Chip label="No warrant" tone="alert" />
        </div>
        <div style={{ width: 240 }} data-testid="gallery-thesis">
          <ThesisGroup number={1} title="Ocean is the nearer frontier">
            <CardView tone="ours" label="OA1" text="We know less about the deep sea than about Mars" expanded={false} points={[
              { id: "x", label: "1a", text: "Only ~25% of the seafloor is mapped in high resolution" },
              { id: "y", label: "1b", text: "New species found on every deep dive" },
              { id: "z", label: "1c", text: "Cheap to explore compared with space" },
            ]} />
            <div className="gap" />
            <CardView tone="ours" label="OA2" text="Climate answers are in the ocean" struck expanded={false} points={[]} plates={[{ text: "from LO", tone: "mono" }]} />
            <div className="gap" />
            <CardView tone="red" label="OA4" text="Jobs on the coast" expanded={false} points={[]} plates={[{ text: "new — don't say", tone: "red" }]} />
          </ThesisGroup>
        </div>
      </section>
    </div>
  );
}
