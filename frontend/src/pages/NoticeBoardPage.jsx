import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import NoticeBoard from "@/components/NoticeBoard";
import ThemeToggle from "@/components/ThemeToggle";

export default function NoticeBoardPage() {
  const { slug } = useParams();
  const [club, setClub] = useState(null);
  const [board, setBoard] = useState(null);
  const [sections, setSections] = useState([]);
  const [disabled, setDisabled] = useState(false);
  useEffect(() => {
    api.getClubs().then((clubs) => setClub((clubs || []).find((c) => c.slug === slug) || null)).catch(() => {});
  }, [slug]);
  useEffect(() => {
    if (!club) return;
    api.getNoticeBoards({ club_id: club.id }).then((boards) => {
      const selected = boards?.[0] || null;
      setDisabled(club.official_notice_board === false);
      setBoard(selected);
      if (selected) api.getNoticeSections(selected.id).then(setSections).catch(() => {});
    }).catch(() => {});
  }, [club]);
  if (!club) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (disabled) return <div className="min-h-screen grid place-items-center bg-background px-4"><div className="text-center"><h1 className="font-heading text-2xl uppercase">Notice Board unavailable</h1><p className="text-muted-foreground mt-2">This club is not currently using the Official Notice Board.</p><Link to={`/club/${club.slug}`}><Button className="mt-5">Back to club results</Button></Link></div></div>;
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3"><Link to={`/club/${club.slug}`}><Logo className="h-11 w-auto" /></Link><span className="font-heading text-xl uppercase tracking-tight">{club.name}</span></div>
          <div className="flex items-center gap-2"><ThemeToggle /><Link to={`/club/${club.slug}`}><Button variant="outline" size="sm" className="gap-1.5 border-ocean text-ocean"><ArrowLeft className="w-4 h-4" /> Results</Button></Link></div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-10">
        <div className="mb-8"><div className="flex items-center gap-2 text-ocean mb-2"><FileText className="w-6 h-6" /><span className="text-xs font-bold uppercase tracking-widest">{club.name}</span></div><h1 className="text-3xl md:text-4xl uppercase tracking-tighter">Official Notice Board</h1><p className="text-muted-foreground mt-2">Sailing instructions, race notices, hearings, results, safety information and general club notices.</p></div>
        {board && sections.length > 0 ? (
          <Tabs defaultValue="club-onb" data-testid="onb-tabs">
            <TabsList className="w-full justify-start overflow-x-auto h-auto gap-2 bg-transparent mb-6">
              <TabsTrigger value="club-onb" className="rounded-lg border border-ocean/30 px-4 py-2 data-[state=active]:bg-ocean data-[state=active]:text-white" data-testid="club-onb-tab">Club ONB</TabsTrigger>
              {sections.filter((s) => s.series_id).map((section) => (
                <TabsTrigger key={section.id} value={section.id} className="rounded-lg border border-ocean/30 px-4 py-2 data-[state=active]:bg-ocean data-[state=active]:text-white" data-testid={`series-onb-tab-${section.id}`}>
                  {section.title}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="club-onb"><NoticeBoard clubId={club.id} embedded /></TabsContent>
            {sections.filter((s) => s.series_id).map((section) => (
              <TabsContent key={section.id} value={section.id} data-testid={`series-onb-content-${section.id}`}>
                <NoticeBoard clubId={club.id} embedded sectionId={section.id} />
              </TabsContent>
            ))}
          </Tabs>
        ) : <NoticeBoard clubId={club.id} embedded />}
      </main>
    </div>
  );
}
