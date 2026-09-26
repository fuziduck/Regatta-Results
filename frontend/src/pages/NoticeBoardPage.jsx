import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import NoticeBoard from "@/components/NoticeBoard";
import ResultsSubscription from "@/components/ResultsSubscription";
import HeaderMenu from "@/components/HeaderMenu";

export default function NoticeBoardPage() {
  const { slug } = useParams();
  const [club, setClub] = useState(null);
  const [disabled, setDisabled] = useState(false);
  useEffect(() => {
    api.getClubs().then((clubs) => setClub((clubs || []).find((c) => c.slug === slug) || null)).catch(() => {});
  }, [slug]);
  useEffect(() => {
    if (!club) return;
    setDisabled(club.official_notice_board === false);
  }, [club]);
  if (!club) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (disabled) return <div className="min-h-screen grid place-items-center bg-background px-4"><div className="text-center"><h1 className="font-heading text-2xl uppercase">Notice Board unavailable</h1><p className="text-muted-foreground mt-2">This club is not currently using the Official Notice Board.</p><Link to={`/club/${club.slug}`}><Button className="mt-5">Back to club results</Button></Link></div></div>;
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3"><HeaderMenu title={`${club.name} · Official Notice Board`} text={`Official Notice Board for ${club.name} on SailScore`} /><Link to={`/club/${club.slug}`}><Logo className="h-11 w-auto" /></Link><span className="font-heading text-xl uppercase tracking-tight">{club.name}</span></div>
          <div className="flex items-center gap-2"><ResultsSubscription subscriptionType="notice" targetId={club.id} targetName={`${club.name} Official Notice Board`} buttonLabel="Subscribe to ONB" dialogTitle="Get notices by email" description={<>We'll email you the official PDF whenever a new notice is published to the <strong className="text-foreground">{club.name} Official Notice Board</strong>. No Sailscore account is needed.</>} /><Link to={`/club/${club.slug}`}><Button variant="outline" size="sm" className="gap-1.5 border-ocean text-ocean"><ArrowLeft className="w-4 h-4" /> Results</Button></Link></div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-10">
        <div className="mb-8"><div className="flex items-center gap-2 text-ocean mb-2"><FileText className="w-6 h-6" /><span className="text-xs font-bold uppercase tracking-widest">{club.name}</span></div><h1 className="text-3xl md:text-4xl uppercase tracking-tighter">Official Notice Board</h1><p className="text-muted-foreground mt-2">Sailing instructions, race notices, hearings, results, safety information and general club notices.</p></div>
        <NoticeBoard key={club.id} clubId={club.id} embedded />
      </main>
    </div>
  );
}
