import React, { useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BellRing,
  Building2,
  Check,
  Cloud,
  Fingerprint,
  Headphones,
  KeyRound,
  LockKeyhole,
  Menu,
  MonitorCheck,
  Network,
  PhoneCall,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  X
} from "lucide-react";
import logo from "../logo.png";

const resources = [
  [Fingerprint, "Reconhecimento facial", "Acesso ágil e seguro com identificação facial."],
  [QrCode, "Convites por QR Code", "Autorizações digitais para visitantes e prestadores."],
  [Smartphone, "Aplicativo para moradores", "Liberações, convites e histórico na palma da mão."],
  [Headphones, "Portaria remota e SIP", "Atendimento e liberação a distância em uma só tela."],
  [MonitorCheck, "Monitoramento em tempo real", "Eventos, equipamentos e acessos sempre visíveis."],
  [BarChart3, "Relatórios e auditoria", "Rastreabilidade para uma operação mais confiável."]
];

const audiences = [
  {
    icon: Smartphone,
    title: "Morador",
    text: "Mais autonomia no dia a dia.",
    items: ["Recebe convites", "Libera acessos", "Visualiza histórico", "Recebe notificações"]
  },
  {
    icon: Headphones,
    title: "Portaria",
    text: "Operação centralizada e rápida.",
    items: ["Visualiza eventos", "Atende chamadas SIP", "Libera remotamente", "Consulta registros"]
  },
  {
    icon: Building2,
    title: "Administradora",
    text: "Gestão completa e escalável.",
    items: ["Gerencia condomínios", "Emite relatórios", "Monitora equipamentos", "Controla usuários"]
  }
];

const differentials = [
  [Building2, "Multi condomínio", "Gerencie toda a sua operação em uma única plataforma."],
  [Sparkles, "White label", "Leve a tecnologia ao mercado com a identidade da sua empresa."],
  [Cloud, "100% em nuvem", "Acesse a operação com segurança, de onde estiver."],
  [Network, "Integração aberta", "Conecte equipamentos e sistemas usando APIs e protocolos modernos."]
];

function scrollToDemo() {
  document.getElementById("demonstracao")?.scrollIntoView({ behavior: "smooth" });
}

function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [formState, setFormState] = useState("idle");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormState("sending");
    const form = event.currentTarget;
    const body = new URLSearchParams(new FormData(form)).toString();

    try {
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      });
      if (!response.ok) throw new Error("Falha ao enviar");
      form.reset();
      setFormState("sent");
    } catch {
      setFormState("error");
    }
  };

  return (
    <div className="landing">
      <header className="landing-header">
        <a className="landing-brand" href="/" aria-label="Condo Access">
          <img src={logo} alt="" />
          <span><strong>Condo</strong> Access</span>
        </a>
        <nav className={menuOpen ? "landing-nav open" : "landing-nav"}>
          <a href="#plataforma" onClick={() => setMenuOpen(false)}>Plataforma</a>
          <a href="#como-funciona" onClick={() => setMenuOpen(false)}>Como funciona</a>
          <a href="#integracoes" onClick={() => setMenuOpen(false)}>Integrações</a>
          <a href="#diferenciais" onClick={() => setMenuOpen(false)}>Diferenciais</a>
          <a className="landing-login" href="/app">Entrar no sistema</a>
          <button className="landing-cta compact" onClick={scrollToDemo}>Solicitar demonstração</button>
        </nav>
        <button className="landing-menu" aria-label="Abrir menu" onClick={() => setMenuOpen((value) => !value)}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <div className="eyebrow"><ShieldCheck size={16} /> Segurança conectada. Gestão inteligente.</div>
            <h1>Controle de acesso inteligente para <em>condomínios.</em></h1>
            <p>Uma plataforma completa para portaria remota, reconhecimento facial, interfonia SIP e gestão de acessos em tempo real.</p>
            <div className="hero-actions">
              <button className="landing-cta" onClick={scrollToDemo}>Solicitar demonstração <ArrowRight size={18} /></button>
              <a className="landing-outline" href="#plataforma">Conhecer a plataforma</a>
            </div>
            <div className="hero-trust">
              <span><Check size={15} /> Multi condomínio</span>
              <span><Check size={15} /> White label</span>
              <span><Check size={15} /> Integrações abertas</span>
            </div>
          </div>

          <div className="hero-visual" aria-label="Visão geral da plataforma Condo Access">
            <div className="visual-glow" />
            <div className="platform-card">
              <div className="platform-top">
                <div className="mini-brand"><img src={logo} alt="" /><span>Condo Access</span></div>
                <span className="live-pill"><i /> Operação online</span>
              </div>
              <div className="platform-body">
                <div className="platform-sidebar">
                  <span className="active"><BarChart3 size={16} /></span>
                  <span><Building2 size={16} /></span>
                  <span><Users size={16} /></span>
                  <span><Fingerprint size={16} /></span>
                </div>
                <div className="platform-content">
                  <div className="platform-title"><span>Visão geral</span><small>Hoje, agora</small></div>
                  <div className="platform-stats">
                    <div><small>Acessos hoje</small><strong>1.284</strong><span>+12% esta semana</span></div>
                    <div><small>Equipamentos</small><strong>24</strong><span>Todos conectados</span></div>
                  </div>
                  <div className="activity-card">
                    <div className="activity-head"><strong>Atividade em tempo real</strong><span>Ver todos</span></div>
                    <div className="activity-row"><i className="face"><Fingerprint size={16} /></i><span><strong>Acesso facial liberado</strong><small>Entrada social · agora</small></span><BadgeCheck size={18} /></div>
                    <div className="activity-row"><i className="qr"><QrCode size={16} /></i><span><strong>Convite utilizado</strong><small>Visitante · há 2 min</small></span><BadgeCheck size={18} /></div>
                    <div className="activity-row"><i className="call"><PhoneCall size={16} /></i><span><strong>Chamada atendida</strong><small>Portaria remota · há 5 min</small></span><BadgeCheck size={18} /></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="floating-card access-ok"><BadgeCheck size={22} /><span><strong>Acesso liberado</strong><small>Reconhecimento facial</small></span></div>
            <div className="floating-card notification"><BellRing size={20} /><span><strong>Notificação enviada</strong><small>Morador informado</small></span></div>
          </div>
        </section>

        <section className="logo-strip">
          <span>Integração com os principais fabricantes e protocolos</span>
          <div><strong>HIKVISION</strong><strong>Control iD</strong><strong>Intelbras</strong><strong>SIP</strong><strong>REST API</strong></div>
        </section>

        <section className="landing-section" id="plataforma">
          <div className="section-heading">
            <div className="eyebrow">Tudo em uma única plataforma</div>
            <h2>Mais controle para a operação.<br />Mais tranquilidade para o condomínio.</h2>
            <p>Centralize acessos, comunicação e equipamentos em uma experiência simples e confiável.</p>
          </div>
          <div className="resource-grid">
            {resources.map(([Icon, title, text]) => <article className="resource-card" key={title}><span><Icon size={23} /></span><h3>{title}</h3><p>{text}</p><a href="#demonstracao">Saiba mais <ArrowRight size={15} /></a></article>)}
          </div>
        </section>

        <section className="landing-section audience-section" id="como-funciona">
          <div className="section-heading">
            <div className="eyebrow">Uma experiência para todos</div>
            <h2>Conecta moradores, portaria e gestão.</h2>
            <p>Cada perfil tem as ferramentas certas para agir com rapidez e segurança.</p>
          </div>
          <div className="audience-grid">
            {audiences.map(({ icon: Icon, title, text, items }, index) => <article className={index === 1 ? "audience-card featured" : "audience-card"} key={title}><span className="audience-icon"><Icon size={25} /></span><h3>{title}</h3><p>{text}</p><ul>{items.map((item) => <li key={item}><Check size={15} /> {item}</li>)}</ul></article>)}
          </div>
        </section>

        <section className="integration-section" id="integracoes">
          <div className="integration-copy">
            <div className="eyebrow light">Integrações que ampliam possibilidades</div>
            <h2>Conecte o que sua operação já utiliza.</h2>
            <p>Compatível com fabricantes líderes de mercado, interfonia SIP, APIs REST e sistemas de terceiros.</p>
            <button className="landing-cta light-button" onClick={scrollToDemo}>Conversar com especialista <ArrowRight size={18} /></button>
          </div>
          <div className="integration-orbit">
            <div className="orbit-center"><img src={logo} alt="" /><strong>Condo<br />Access</strong></div>
            <span className="orbit-item item-one">HIKVISION</span>
            <span className="orbit-item item-two">Control iD</span>
            <span className="orbit-item item-three">Intelbras</span>
            <span className="orbit-item item-four">SIP</span>
          </div>
        </section>

        <section className="landing-section" id="diferenciais">
          <div className="section-heading">
            <div className="eyebrow">Preparada para crescer com você</div>
            <h2>Tecnologia para condomínios e empresas de segurança.</h2>
          </div>
          <div className="differential-grid">
            {differentials.map(([Icon, title, text]) => <article key={title}><span><Icon size={23} /></span><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </section>

        <section className="demo-section" id="demonstracao">
          <div className="demo-copy">
            <div className="eyebrow light">Veja a Condo Access em ação</div>
            <h2>Modernize sua operação de controle de acesso.</h2>
            <p>Conte um pouco sobre sua empresa ou condomínio. Nossa equipe prepara uma demonstração focada no seu cenário.</p>
            <div className="demo-points">
              <span><LockKeyhole size={20} /><strong>Sem compromisso</strong><small>Conheça a solução antes de decidir.</small></span>
              <span><KeyRound size={20} /><strong>Demonstração personalizada</strong><small>Uma conversa prática sobre sua operação.</small></span>
            </div>
          </div>
          <form className="demo-form" name="demonstracao" method="POST" data-netlify="true" onSubmit={handleSubmit}>
            <input type="hidden" name="form-name" value="demonstracao" />
            <h3>Solicite uma demonstração</h3>
            <p>Preencha os dados e entraremos em contato.</p>
            <label>Nome<input name="nome" required placeholder="Seu nome" /></label>
            <label>Empresa ou condomínio<input name="empresa" required placeholder="Nome da empresa" /></label>
            <div className="form-split"><label>Cidade<input name="cidade" required placeholder="Sua cidade" /></label><label>Telefone<input name="telefone" required placeholder="(00) 00000-0000" /></label></div>
            <label>E-mail corporativo<input type="email" name="email" required placeholder="voce@empresa.com.br" /></label>
            <button className="landing-cta" disabled={formState === "sending"}>{formState === "sending" ? "Enviando..." : "Agendar demonstração"} <ArrowRight size={18} /></button>
            {formState === "sent" && <span className="form-feedback success">Recebemos seus dados. Em breve nossa equipe entrará em contato.</span>}
            {formState === "error" && <span className="form-feedback error">Não foi possível enviar agora. Tente novamente em instantes.</span>}
            <small>Seus dados serão usados somente para contato comercial.</small>
          </form>
        </section>
      </main>

      <footer className="landing-footer">
        <a className="landing-brand" href="/"><img src={logo} alt="" /><span><strong>Condo</strong> Access</span></a>
        <p>Plataforma inteligente para controle de acesso e portaria remota.</p>
        <a href="/app">Acessar sistema <ArrowRight size={15} /></a>
      </footer>
    </div>
  );
}

export default LandingPage;
