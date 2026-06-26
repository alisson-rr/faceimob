import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Pencil, Trash2, Play, Square } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const YEARS = ["2023", "2024", "2025", "2026"];
const TEAMS = ["Archimedes", "Zona Sul", "Mauricio", "Jose Portilho", "Faceimob", "Susana", "Victor", "Veronica", "Alisson", "Alexandre", "Daiane Dias", "Leonardo"];
const DEVELOPERS = ["TENDA", "VASCO", "ABACO", "MRV", "MORANA", "CYRELA", "AVULSO", "SOUTH", "MELNICK", "FINI", "Direcional"];
const CCAS = ["CCA Faceimob", "CCA Externo"];

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="bg-[#0b1a3a]/60 border-border/40 p-0 overflow-hidden max-w-2xl mx-auto">
      <div className="bg-[#1a2f5e]/80 px-4 py-2 text-sm font-semibold">{title}</div>
      <div className="bg-card p-5">{children}</div>
    </Card>
  );
}

function TableCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="bg-[#0b1a3a]/60 border-border/40 p-0 overflow-hidden max-w-3xl mx-auto mt-6">
      <div className="bg-[#1a2f5e]/80 px-4 py-2 text-sm font-semibold text-center">{title}</div>
      <div className="bg-card">{children}</div>
    </Card>
  );
}

function FileUpload({ onFile, hint }: { onFile: (f: File) => void; hint?: string }) {
  return (
    <label className="block border border-dashed border-primary/60 rounded p-10 text-center cursor-pointer bg-background hover:bg-secondary/30 transition">
      <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
      <p className="text-xs text-muted-foreground">{hint || "Clique para carregar o arquivo"}</p>
    </label>
  );
}

export default function DataManagement() {
  const [tab, setTab] = useState("leadfy");

  // Marketing
  const [mkInvest, setMkInvest] = useState("");
  const [mkMes, setMkMes] = useState("");

  // Metas equipe
  const [metaEq, setMetaEq] = useState(""); const [metaEqTeam, setMetaEqTeam] = useState(""); const [metaEqMes, setMetaEqMes] = useState("");
  const [metasEquipe, setMetasEquipe] = useState<any[]>([]);
  // Metas construtora
  const [metaCo, setMetaCo] = useState(""); const [metaCoDev, setMetaCoDev] = useState(""); const [metaCoTeam, setMetaCoTeam] = useState(""); const [metaCoMes, setMetaCoMes] = useState("");

  // Equipe
  const [novaEquipe, setNovaEquipe] = useState(""); const [novoGerente, setNovoGerente] = useState("");
  const [equipes, setEquipes] = useState([
    { nome: "Archimedes", gerente: "Archimedes Bolf", corretores: 15 },
    { nome: "Zona Sul", gerente: "Fabio Batista", corretores: 29 },
    { nome: "Mauricio", gerente: "Mauricio Vieira", corretores: 19 },
    { nome: "Jose Portilho", gerente: "Jose Portilho", corretores: 43 },
    { nome: "Faceimob", gerente: "Gerente Interino", corretores: 1 },
    { nome: "Susana", gerente: "Susana Cristina Prates", corretores: 13 },
    { nome: "Victor", gerente: "Victor Rafael", corretores: 42 },
    { nome: "Veronica", gerente: "Veronica Oliveira", corretores: 6 },
    { nome: "Alisson", gerente: "Alisson Luiz", corretores: 24 },
  ]);

  // Construtora
  const [coNome, setCoNome] = useState(""); const [coMeta, setCoMeta] = useState(""); const [coCCA, setCoCCA] = useState(""); const [coCor, setCoCor] = useState("#1a2f5e");
  const [construtoras, setConstrutoras] = useState([
    { nome: "TENDA", meta: 40, cca: "CCA Faceimob", cor: "#fb0205" },
    { nome: "VASCO", meta: 25, cca: "CCA Faceimob", cor: "#f07777" },
    { nome: "ABACO", meta: 0, cca: "CCA Externo", cor: "#bec1fd" },
    { nome: "MRV", meta: 10, cca: "CCA Externo", cor: "#29c509" },
    { nome: "MORANA", meta: 10, cca: "CCA Faceimob", cor: "#7f09c5" },
    { nome: "CYRELA", meta: 0, cca: "CCA Faceimob", cor: "#d6acef" },
    { nome: "AVULSO", meta: 0, cca: "CCA Faceimob", cor: "#8e8e8e" },
    { nome: "SOUTH", meta: 0, cca: "CCA Externo", cor: "#0028aa" },
    { nome: "MELNICK", meta: 0, cca: "CCA Faceimob", cor: "#15b3b0" },
  ]);

  // Resultados
  const [resMes, setResMes] = useState(""); const [resVendas, setResVendas] = useState(""); const [resVGV, setResVGV] = useState("");
  const [resultados] = useState([
    { ano: 2024, mes: "Janeiro", vendas: 58, vgv: "R$11.095.182,46" },
    { ano: 2024, mes: "Fevereiro", vendas: 43, vgv: "R$7.989.636,63" },
    { ano: 2024, mes: "Março", vendas: 77, vgv: "R$14.853.659,22" },
    { ano: 2024, mes: "Abril", vendas: 67, vgv: "R$12.690.867,98" },
    { ano: 2023, mes: "Janeiro", vendas: 57, vgv: "R$10.133.407,81" },
    { ano: 2023, mes: "Fevereiro", vendas: 51, vgv: "R$8.962.320,36" },
    { ano: 2023, mes: "Março", vendas: 71, vgv: "R$12.701.072,44" },
    { ano: 2023, mes: "Abril", vendas: 60, vgv: "R$10.720.916,74" },
    { ano: 2023, mes: "Maio", vendas: 68, vgv: "R$12.661.644,93" },
    { ano: 2023, mes: "Junho", vendas: 62, vgv: "R$11.255.850,95" },
  ]);

  // Gameficação
  const [recado, setRecado] = useState("");
  const [dica, setDica] = useState("");

  // Norteador / Links placeholder
  const [norteador, setNorteador] = useState("");
  const [linkNome, setLinkNome] = useState(""); const [linkUrl, setLinkUrl] = useState("");
  const [links, setLinks] = useState<any[]>([]);

  const handleAddMetaEquipe = () => {
    if (!metaEq || !metaEqTeam || !metaEqMes) return toast({ title: "Preencha todos os campos", variant: "destructive" });
    setMetasEquipe(p => [...p, { meta: metaEq, equipe: metaEqTeam, mes: metaEqMes }]);
    setMetaEq(""); setMetaEqTeam(""); setMetaEqMes("");
    toast({ title: "Meta adicionada" });
  };

  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="bg-transparent border-b border-border/40 rounded-none w-full justify-center gap-6 h-auto p-0 overflow-x-auto">
          {[
            ["leadfy", "Leadfy"],
            ["marketing", "Marketing"],
            ["metas", "Metas"],
            ["equipe", "Equipe"],
            ["construtora", "Construtora"],
            ["norteador", "Norteador"],
            ["links", "Links"],
            ["resultados", "Resultados"],
            ["game", "Gameficação"],
          ].map(([v, l]) => (
            <TabsTrigger
              key={v}
              value={v}
              className="bg-transparent rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground pb-2 font-semibold"
            >
              {l}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* LEADFY */}
        <TabsContent value="leadfy" className="mt-8">
          <SectionCard title="Adicionar Arquivo Leadfy">
            <FileUpload onFile={(f) => toast({ title: `Arquivo ${f.name} carregado` })} />
          </SectionCard>
        </TabsContent>

        {/* MARKETING */}
        <TabsContent value="marketing" className="mt-8 space-y-6">
          <SectionCard title="Adicionar Arquivo Marketing">
            <FileUpload onFile={(f) => toast({ title: `Arquivo ${f.name} carregado` })} />
          </SectionCard>
          <SectionCard title="Adicionar Valor Investido">
            <div className="space-y-3">
              <Input placeholder="Inserir Valor Investido" value={mkInvest} onChange={e => setMkInvest(e.target.value)} className="rounded-full" />
              <Select value={mkMes} onValueChange={setMkMes}>
                <SelectTrigger className="rounded-full"><SelectValue placeholder="Escolher Mês/Ano" /></SelectTrigger>
                <SelectContent>{YEARS.flatMap(y => MONTHS.map(m => <SelectItem key={`${m}-${y}`} value={`${m}-${y}`}>{m}/{y}</SelectItem>))}</SelectContent>
              </Select>
              <div className="flex justify-center pt-2">
                <Button className="bg-primary px-8" onClick={() => { toast({ title: "Valor adicionado" }); setMkInvest(""); setMkMes(""); }}>Adicionar Valor Investido</Button>
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* METAS */}
        <TabsContent value="metas" className="mt-8 space-y-6">
          <SectionCard title="Adicionar Meta Equipe">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input placeholder="Inserir meta" value={metaEq} onChange={e => setMetaEq(e.target.value)} className="rounded-full" />
              <Select value={metaEqTeam} onValueChange={setMetaEqTeam}>
                <SelectTrigger className="rounded-full"><SelectValue placeholder="Escolher equipe" /></SelectTrigger>
                <SelectContent>{TEAMS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={metaEqMes} onValueChange={setMetaEqMes}>
                <SelectTrigger className="rounded-full"><SelectValue placeholder="Escolher Mês/Ano" /></SelectTrigger>
                <SelectContent>{YEARS.flatMap(y => MONTHS.map(m => <SelectItem key={`${m}-${y}`} value={`${m}-${y}`}>{m}/{y}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="flex justify-center pt-4">
              <Button className="bg-primary px-8" onClick={handleAddMetaEquipe}>Adicionar Meta</Button>
            </div>
          </SectionCard>

          <SectionCard title="Adicionar Meta Construtora">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input placeholder="Inserir meta" value={metaCo} onChange={e => setMetaCo(e.target.value)} className="rounded-full" />
              <Select value={metaCoDev} onValueChange={setMetaCoDev}>
                <SelectTrigger className="rounded-full"><SelectValue placeholder="Escolher construtora" /></SelectTrigger>
                <SelectContent>{DEVELOPERS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={metaCoTeam} onValueChange={setMetaCoTeam}>
                <SelectTrigger className="rounded-full"><SelectValue placeholder="Escolher equipe" /></SelectTrigger>
                <SelectContent>{TEAMS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Select value={metaCoMes} onValueChange={setMetaCoMes}>
              <SelectTrigger className="rounded-full mt-3"><SelectValue placeholder="Escolher Mês/Ano" /></SelectTrigger>
              <SelectContent>{YEARS.flatMap(y => MONTHS.map(m => <SelectItem key={`${m}-${y}`} value={`${m}-${y}`}>{m}/{y}</SelectItem>))}</SelectContent>
            </Select>
            <div className="flex justify-center pt-4">
              <Button className="bg-primary px-8" onClick={() => toast({ title: "Meta construtora adicionada" })}>Adicionar Meta</Button>
            </div>
          </SectionCard>

          {metasEquipe.length > 0 && (
            <TableCard title="Metas Equipe">
              <Table>
                <TableHeader><TableRow><TableHead>Equipe</TableHead><TableHead>Meta</TableHead><TableHead>Mês</TableHead></TableRow></TableHeader>
                <TableBody>
                  {metasEquipe.map((m, i) => <TableRow key={i}><TableCell>{m.equipe}</TableCell><TableCell>{m.meta}</TableCell><TableCell>{m.mes}</TableCell></TableRow>)}
                </TableBody>
              </Table>
            </TableCard>
          )}
        </TabsContent>

        {/* EQUIPE */}
        <TabsContent value="equipe" className="mt-8 space-y-6">
          <SectionCard title="Adicionar Equipe">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input placeholder="Inserir nome equipe" value={novaEquipe} onChange={e => setNovaEquipe(e.target.value)} className="rounded-full" />
              <Select value={novoGerente} onValueChange={setNovoGerente}>
                <SelectTrigger className="rounded-full"><SelectValue placeholder="Escolher gerente" /></SelectTrigger>
                <SelectContent>{equipes.map(e => <SelectItem key={e.gerente} value={e.gerente}>{e.gerente}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex justify-center pt-4">
              <Button className="bg-primary px-8" onClick={() => {
                if (!novaEquipe || !novoGerente) return;
                setEquipes(p => [...p, { nome: novaEquipe, gerente: novoGerente, corretores: 0 }]);
                setNovaEquipe(""); setNovoGerente(""); toast({ title: "Equipe adicionada" });
              }}>Adicionar Equipe</Button>
            </div>
          </SectionCard>

          <TableCard title="Equipes">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome Equipe</TableHead><TableHead>Gerente</TableHead><TableHead>Corretores</TableHead>
                  <TableHead className="text-center">Editar</TableHead><TableHead className="text-center">Deletar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipes.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell>{e.nome}</TableCell>
                    <TableCell>{e.gerente}</TableCell>
                    <TableCell>{e.corretores}</TableCell>
                    <TableCell className="text-center"><Button variant="ghost" size="sm"><Pencil className="h-3.5 w-3.5 text-blue-400" /></Button></TableCell>
                    <TableCell className="text-center"><Button variant="ghost" size="sm" onClick={() => setEquipes(p => p.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </TabsContent>

        {/* CONSTRUTORA */}
        <TabsContent value="construtora" className="mt-8 space-y-6">
          <SectionCard title="Adicionar Construtora">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Input placeholder="Inserir nome construtora" value={coNome} onChange={e => setCoNome(e.target.value)} className="rounded-full" />
              <Input placeholder="Inserir meta construtora" value={coMeta} onChange={e => setCoMeta(e.target.value)} className="rounded-full" />
              <Select value={coCCA} onValueChange={setCoCCA}>
                <SelectTrigger className="rounded-full"><SelectValue placeholder="Escolher CCA" /></SelectTrigger>
                <SelectContent>{CCAS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              <input type="color" value={coCor} onChange={e => setCoCor(e.target.value)} className="h-10 w-full rounded border border-border bg-background" />
            </div>
            <div className="flex justify-center pt-4">
              <Button className="bg-primary px-8" onClick={() => {
                if (!coNome) return;
                setConstrutoras(p => [...p, { nome: coNome, meta: Number(coMeta) || 0, cca: coCCA || CCAS[0], cor: coCor }]);
                setCoNome(""); setCoMeta(""); setCoCCA(""); toast({ title: "Construtora adicionada" });
              }}>Adicionar Construtora</Button>
            </div>
          </SectionCard>

          <TableCard title="Construtoras">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center">Nome</TableHead><TableHead className="text-center">Meta</TableHead>
                  <TableHead className="text-center">CCA</TableHead><TableHead className="text-center">Cor</TableHead>
                  <TableHead className="text-center">Alterar</TableHead><TableHead className="text-center">Deletar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {construtoras.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-center">{c.nome}</TableCell>
                    <TableCell className="text-center">{c.meta || ""}</TableCell>
                    <TableCell className="text-center">{c.cca}</TableCell>
                    <TableCell className="text-center">
                      <span className="px-2 py-1 rounded text-xs text-black font-mono" style={{ background: c.cor }}>{c.cor}</span>
                    </TableCell>
                    <TableCell className="text-center"><Button variant="ghost" size="sm"><Pencil className="h-3.5 w-3.5 text-blue-400" /></Button></TableCell>
                    <TableCell className="text-center"><Button variant="ghost" size="sm" onClick={() => setConstrutoras(p => p.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </TabsContent>

        {/* NORTEADOR */}
        <TabsContent value="norteador" className="mt-8">
          <SectionCard title="Conteúdo Norteador">
            <Textarea placeholder="Inserir conteúdo do norteador..." rows={8} value={norteador} onChange={e => setNorteador(e.target.value)} />
            <div className="flex justify-center pt-4">
              <Button className="bg-primary px-8" onClick={() => toast({ title: "Norteador salvo" })}>Salvar Norteador</Button>
            </div>
          </SectionCard>
        </TabsContent>

        {/* LINKS */}
        <TabsContent value="links" className="mt-8 space-y-6">
          <SectionCard title="Adicionar Link">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input placeholder="Nome do link" value={linkNome} onChange={e => setLinkNome(e.target.value)} className="rounded-full" />
              <Input placeholder="URL" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} className="rounded-full" />
            </div>
            <div className="flex justify-center pt-4">
              <Button className="bg-primary px-8" onClick={() => {
                if (!linkNome || !linkUrl) return;
                setLinks(p => [...p, { nome: linkNome, url: linkUrl }]); setLinkNome(""); setLinkUrl("");
                toast({ title: "Link adicionado" });
              }}>Adicionar Link</Button>
            </div>
          </SectionCard>
          {links.length > 0 && (
            <TableCard title="Links">
              <Table>
                <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>URL</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {links.map((l, i) => (
                    <TableRow key={i}><TableCell>{l.nome}</TableCell><TableCell className="text-xs text-blue-400">{l.url}</TableCell>
                      <TableCell className="text-center"><Button variant="ghost" size="sm" onClick={() => setLinks(p => p.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )}
        </TabsContent>

        {/* RESULTADOS */}
        <TabsContent value="resultados" className="mt-8 space-y-6">
          <SectionCard title="Adicionar Resultado Anual">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select value={resMes} onValueChange={setResMes}>
                <SelectTrigger className="rounded-full"><SelectValue placeholder="Escolher Mês/Ano" /></SelectTrigger>
                <SelectContent>{YEARS.flatMap(y => MONTHS.map(m => <SelectItem key={`${m}-${y}`} value={`${m}-${y}`}>{m}/{y}</SelectItem>))}</SelectContent>
              </Select>
              <Input placeholder="Inserir Vendas" value={resVendas} onChange={e => setResVendas(e.target.value)} className="rounded-full" />
              <Input placeholder="Inserir VGV" value={resVGV} onChange={e => setResVGV(e.target.value)} className="rounded-full" />
            </div>
            <div className="flex justify-center pt-4">
              <Button className="bg-primary px-8" onClick={() => toast({ title: "Resultado adicionado" })}>Adicionar Resultado</Button>
            </div>
          </SectionCard>

          <TableCard title="Resultados Anuais">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center">Ano</TableHead><TableHead className="text-center">Mês</TableHead>
                  <TableHead className="text-center">Vendas</TableHead><TableHead className="text-center">VGV</TableHead>
                  <TableHead className="text-center">Informações</TableHead><TableHead className="text-center">Deletar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultados.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-center">{r.ano}</TableCell><TableCell className="text-center">{r.mes}</TableCell>
                    <TableCell className="text-center">{r.vendas}</TableCell><TableCell className="text-center">{r.vgv}</TableCell>
                    <TableCell className="text-center"><Button variant="ghost" size="sm"><Pencil className="h-3.5 w-3.5 text-blue-400" /></Button></TableCell>
                    <TableCell className="text-center"><Button variant="ghost" size="sm"><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </TabsContent>

        {/* GAMEFICAÇÃO */}
        <TabsContent value="game" className="mt-8 space-y-6">
          <div className="flex justify-between max-w-3xl mx-auto">
            <Button variant="outline" onClick={() => toast({ title: "Gameficação iniciada" })}><Play className="h-4 w-4 mr-2" />Iniciar Gameficação</Button>
            <Button variant="outline" onClick={() => toast({ title: "Gameficação encerrada" })}><Square className="h-4 w-4 mr-2" />Fechar Gameficação</Button>
          </div>

          <SectionCard title="Adicionar Recado Faceimob">
            <label className="text-xs font-semibold mb-2 block">Mensagem</label>
            <Textarea rows={6} value={recado} onChange={e => setRecado(e.target.value)} />
            <div className="flex justify-center pt-4">
              <Button className="bg-secondary px-8" onClick={() => toast({ title: "Mensagem do dia salva" })}>Adicionar Mensagem do Dia</Button>
            </div>
          </SectionCard>

          <SectionCard title="Adicionar Dica Ouro">
            <label className="text-xs font-semibold mb-2 block">Dica</label>
            <Textarea rows={6} value={dica} onChange={e => setDica(e.target.value)} />
            <div className="flex justify-center pt-4">
              <Button className="bg-secondary px-8" onClick={() => toast({ title: "Dica Ouro salva" })}>Adicionar Dica</Button>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
