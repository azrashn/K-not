import { useState } from 'react';
import { 
  Search, BookOpen, Layers, History, Settings, 
  HelpCircle, ChevronRight, FileText, ArrowRight,
  CheckCircle2
} from 'lucide-react';

function App() {
  const [activeNav, setActiveNav] = useState('workspace');

  return (
    <div className="app-container">
      {/* Sidebar Rail */}
      <aside className="sidebar-rail">
        <div className="sidebar-header">
          <BookOpen size={24} color="var(--accent)" />
          <span>K-not</span>
        </div>
        
        <nav className="sidebar-nav">
          <a 
            href="#" 
            className={`nav-item ${activeNav === 'workspace' ? 'active' : ''}`}
            onClick={() => setActiveNav('workspace')}
          >
            <Search size={20} />
            AI Workspace
          </a>
          <a 
            href="#" 
            className={`nav-item ${activeNav === 'courses' ? 'active' : ''}`}
            onClick={() => setActiveNav('courses')}
          >
            <Layers size={20} />
            My Courses
          </a>
          <a 
            href="#" 
            className={`nav-item ${activeNav === 'history' ? 'active' : ''}`}
            onClick={() => setActiveNav('history')}
          >
            <History size={20} />
            History
          </a>
        </nav>
        
        <div className="sidebar-nav" style={{ flex: 'none', borderTop: '1px solid var(--border-subtle)' }}>
          <a href="#" className="nav-item">
            <HelpCircle size={20} />
            Support
          </a>
          <a href="#" className="nav-item">
            <Settings size={20} />
            Settings
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="topbar">
          <div className="flex items-center gap-2">
            <h2 className="text-lg">AI Workspace</h2>
            <ChevronRight size={16} className="text-muted" />
            <span className="badge">Drafts</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="knot-indicator">
              <CheckCircle2 size={16} className="text-muted" />
              Connected to 4 Courses
            </div>
            <button className="btn btn-outline">New Thread</button>
          </div>
        </header>

        <div className="workspace-area">
          
          {/* Ask Box Area */}
          <div className="flex flex-col gap-4 items-center w-full mt-6">
            <h1 className="text-2xl" style={{ fontSize: '2rem' }}>What do you want to learn?</h1>
            <p className="text-muted">Ask questions strictly from books, slides, notes, and past exams.</p>
            
            <div className="ask-box-container mt-4">
              <Search size={20} className="text-muted" />
              <input 
                type="text" 
                className="ask-box-input" 
                placeholder="e.g., How does the transformer architecture handle positional encoding?" 
              />
              <button className="ask-btn">
                <ArrowRight size={20} />
              </button>
            </div>
            
            <div className="flex gap-2 mt-2">
              <span className="citation-pill"><FileText size={14}/> CS 420: Deep Learning</span>
              <span className="citation-pill"><FileText size={14}/> INFO 312: Databases</span>
            </div>
          </div>

          <div className="flex gap-6 mt-6">
            {/* Left Column: Recent Activity / Claims */}
            <div className="flex-col gap-4" style={{ flex: 2 }}>
              <h3 className="text-lg">Recent Discoveries (Knowledge Thread)</h3>
              
              <div className="claims-container mt-4">
                {/* Claim Row 1 */}
                <div className="claim-row">
                  <div className="claim-header">
                    <span className="font-medium">Positional Encoding Formulas</span>
                    <span className="badge">CS 420</span>
                  </div>
                  <p className="text-sm text-muted">
                    The transformer uses sine and cosine functions of different frequencies for positional encoding. This allows the model to easily learn to attend by relative positions.
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="citation-pill">Lecture 4, Slide 12</span>
                    <span className="citation-pill">Textbook p. 320</span>
                  </div>
                </div>

                {/* Claim Row 2 */}
                <div className="claim-row">
                  <div className="claim-header">
                    <span className="font-medium">ACID Properties in Distributed Systems</span>
                    <span className="badge">INFO 312</span>
                  </div>
                  <p className="text-sm text-muted">
                    In distributed databases, full ACID compliance often trades off with availability (CAP theorem). Relaxed consistency models like BASE are often used.
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="citation-pill">Midterm 2023, Q4</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Quick Access Courses */}
            <div className="flex-col gap-4" style={{ flex: 1 }}>
              <h3 className="text-lg">Active Courses</h3>
              
              <div className="flex flex-col gap-4 mt-4">
                <div className="card">
                  <div className="card-header flex justify-between items-start">
                    <div>
                      <h4 className="font-medium">Deep Learning</h4>
                      <p className="text-xs text-muted mt-2">CS 420 • Prof. Smith</p>
                    </div>
                    <BookOpen size={20} className="text-muted" />
                  </div>
                  <button className="btn w-full btn-outline mt-4">Go to Course</button>
                </div>

                <div className="card">
                  <div className="card-header flex justify-between items-start">
                    <div>
                      <h4 className="font-medium">Database Systems</h4>
                      <p className="text-xs text-muted mt-2">INFO 312 • Prof. Johnson</p>
                    </div>
                    <BookOpen size={20} className="text-muted" />
                  </div>
                  <button className="btn w-full btn-outline mt-4">Go to Course</button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

export default App;
