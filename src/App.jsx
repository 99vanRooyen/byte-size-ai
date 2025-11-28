import { useState, useEffect } from "react";

const MODES = [
  "Chat / Brain",
  "Campaign Builder",
  "Image Prompts",
  "Video Prompts",
];

const BRANDS = ["DSSA", "LVR", "AI"];

const INITIAL_MESSAGES = [
  {
    role: "system",
    text:
      "WELCOME TO Leonard van Rooyen's personal AI. CHOOSE A BRAND, PICK A MODE, AND TELL ME WHAT YOU WANT TO CREATE.",
  },
];

// 🔹 Base URL for backend (local in dev, Render in production)
const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3001";

// 🔹 Only use the cheap video models from fal.ai
const VIDEO_MODELS = [
  {
    id: "fal-ai/ovi",
    label: "Ovi (per video)",
    priceLabel: "Paid • ~ $0.20 / video • ≈ 5 videos per $1",
  },
  {
    id: "fal-ai/wan-2.5",
    label: "Wan 2.5 (per second)",
    priceLabel: "Paid • ~ $0.05 / sec • ≈ 20 sec per $1",
  },
];

function createId() {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}

function App() {
  // ---------- AUTH ----------
  const [token, setToken] = useState(() => localStorage.getItem("authToken"));
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  // ---------- BRAND / MODE ----------
  const [activeBrand, setActiveBrand] = useState(BRANDS[0]);
  const [activeMode, setActiveMode] = useState(MODES[0]);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [isSending, setIsSending] = useState(false);

  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelError, setModelError] = useState(null);

  // 🔹 video model selection (fal.ai) – default Ovi
  const [selectedVideoModel, setSelectedVideoModel] = useState(
    VIDEO_MODELS[0].id
  );

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isBrandOpen, setIsBrandOpen] = useState(false);
  const [isModeOpen, setIsModeOpen] = useState(false);

  const [projects, setProjects] = useState([]);
  const [chats, setChats] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeChatId, setActiveChatId] = useState(null);
  const [expandedProjectId, setExpandedProjectId] = useState(null);

  // ---------- AUTH HANDLERS ----------
  async function handleLogin(e) {
    e.preventDefault();
    setLoginError("");

    try {
      const res = await fetch(`${API_BASE_URL}/api/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Login failed");
      }

      localStorage.setItem("authToken", data.token);
      setToken(data.token);
      setPassword("");
    } catch (err) {
      setLoginError(err.message || "Login failed");
    }
  }

  function handleLogout() {
    localStorage.removeItem("authToken");
    setToken(null);
    setModels([]);
    setSelectedModel(null);
    setModelError(null);
  }

  // ---------- LOAD MODELS (OPENROUTER) ----------
  useEffect(() => {
    if (!token) return;

    async function fetchModels() {
      try {
        setIsLoadingModels(true);
        setModelError(null);

        const res = await fetch(`${API_BASE_URL}/api/models`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json();

        if (res.status === 401) {
          handleLogout();
          return;
        }

        if (!res.ok) {
          throw new Error(data.error || "Failed to load models");
        }

        const list = data.models || [];
        setModels(list);

        if (list.length > 0) {
          const free = list.find((m) => m.isFree);
          setSelectedModel(free ? free.id : list[0].id);
        }
      } catch (err) {
        console.error("Error loading models:", err);
        setModelError("Could not load models from OpenRouter.");
      } finally {
        setIsLoadingModels(false);
      }
    }

    fetchModels();
  }, [token]);

  function formatPrice(pricing) {
    if (!pricing) return "Unknown pricing";

    const { prompt, completion } = pricing;

    const isFree =
      (prompt == null || prompt === 0) &&
      (completion == null || completion === 0);

    if (isFree) return "Free on OpenRouter";

    return `Paid • ${prompt}/1M prompt tokens, ${completion}/1M completion tokens`;
  }

  // ---------- MODE FILTERING ----------
  const isImageMode = activeMode === "Image Prompts";
  const isVideoMode = activeMode === "Video Prompts";

  const filteredModels = models.filter((m) => {
    if (isImageMode) return m.isImageCapable;
    if (isVideoMode) return m.isVideoCapable;
    return true;
  });

  useEffect(() => {
    if (!models.length) return;

    const compat = models.filter((m) => {
      if (isImageMode) return m.isImageCapable;
      if (isVideoMode) return m.isVideoCapable;
      return true;
    });

    if (!compat.length) return;

    if (!compat.some((m) => m.id === selectedModel)) {
      setSelectedModel(compat[0].id);
    }
  }, [activeMode, models, selectedModel]);

  const selectedModelObj =
    filteredModels.find((m) => m.id === selectedModel) || null;

  // ---------- PROJECTS / CHATS INIT ----------
  useEffect(() => {
    if (!token) return; // only load after login

    async function loadChatState() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/chat-state`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          throw new Error("Failed to load chat state");
        }

        const data = await res.json();
        const serverProjects = data.projects || [];
        const serverChats = data.chats || [];

        if (serverProjects.length || serverChats.length) {
          setProjects(serverProjects);
          setChats(serverChats);

          const firstChat = serverChats[0] || null;

          setActiveChatId(firstChat ? firstChat.id : null);
          setActiveProjectId(firstChat ? firstChat.projectId || null : null);
          setExpandedProjectId(firstChat?.projectId || null);
          setMessages(
            firstChat?.messages?.length ? firstChat.messages : INITIAL_MESSAGES
          );
        } else {
          // No state in DB yet -> create default
          const defaultProject = {
            id: createId(),
            name: "General",
            createdAt: Date.now(),
          };
          const defaultChat = {
            id: createId(),
            projectId: null,
            title: "New chat",
            messages: INITIAL_MESSAGES,
            createdAt: Date.now(),
          };

          setProjects([defaultProject]);
          setChats([defaultChat]);
          setActiveChatId(defaultChat.id);
          setActiveProjectId(null);
          setExpandedProjectId(null);
          setMessages(INITIAL_MESSAGES);
        }
      } catch (err) {
        console.error("Error loading chat state from backend:", err);
        // Fallback: same default as above if something explodes
        const defaultProject = {
          id: createId(),
          name: "General",
          createdAt: Date.now(),
        };
        const defaultChat = {
          id: createId(),
          projectId: null,
          title: "New chat",
          messages: INITIAL_MESSAGES,
          createdAt: Date.now(),
        };

        setProjects([defaultProject]);
        setChats([defaultChat]);
        setActiveChatId(defaultChat.id);
        setActiveProjectId(null);
        setExpandedProjectId(null);
        setMessages(INITIAL_MESSAGES);
      }
    }

    loadChatState();
  }, [token]);

  // ---------- SAVE ----------
  useEffect(() => {
    try {
      localStorage.setItem("byteSizeProjects", JSON.stringify(projects));
      localStorage.setItem("byteSizeChats", JSON.stringify(chats));
    } catch (err) {
      console.error("Error saving chat data:", err);
    }
  }, [projects, chats]);

  // ---------- CHAT TITLE ----------
  function getChatTitleFromMessages(messages, fallback = "New chat") {
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser || !firstUser.text) return fallback;

    const trimmed = firstUser.text.trim();
    if (!trimmed) return fallback;

    return trimmed.length > 40 ? trimmed.slice(0, 37) + "..." : trimmed;
  }

  function setMessagesAndPersist(newMessages) {
    setMessages(newMessages);
    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === activeChatId
          ? {
              ...chat,
              messages: newMessages,
              title: getChatTitleFromMessages(newMessages, chat.title),
            }
          : chat
      )
    );
  }

  // ---------- CREATE PROJECT ----------
  function handleCreateProject() {
    const name = window.prompt("Project name");
    if (!name || !name.trim()) return;

    const project = {
      id: createId(),
      name: name.trim(),
      createdAt: Date.now(),
    };

    setProjects((prev) => [...prev, project]);
    setActiveProjectId(project.id);
    setExpandedProjectId(project.id);
  }

  // ---------- DELETE PROJECT ----------
  function handleDeleteProject(projectId) {
    if (
      !window.confirm(
        "Delete this project and all its chats? This cannot be undone."
      )
    ) {
      return;
    }

    setProjects((prev) => prev.filter((p) => p.id !== projectId));

    setChats((prevChats) => {
      const remaining = prevChats.filter((c) => c.projectId !== projectId);

      const activeChat = prevChats.find((c) => c.id === activeChatId);
      if (activeChat && activeChat.projectId === projectId) {
        const fallback = remaining[0] || null;
        setActiveChatId(fallback ? fallback.id : null);
        setActiveProjectId(fallback ? fallback.projectId || null : null);
        setExpandedProjectId(fallback?.projectId || null);
        setMessages(fallback?.messages || INITIAL_MESSAGES);
      }

      if (activeProjectId === projectId) {
        setActiveProjectId(null);
        if (!remaining.length) {
          setExpandedProjectId(null);
        }
      }

      return remaining;
    });
  }

  // ---------- NEW CHAT ----------
  function handleNewChat(projectIdOverride) {
    const projectId = projectIdOverride ?? null;

    const chat = {
      id: createId(),
      projectId,
      title: "New chat",
      messages: INITIAL_MESSAGES,
      createdAt: Date.now(),
    };

    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat.id);
    setActiveProjectId(projectId);
    setExpandedProjectId(projectId || null);
    setMessages(INITIAL_MESSAGES);
  }

  // ---------- SELECT CHAT ----------
  function handleSelectChat(chatId) {
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) return;

    setActiveChatId(chatId);
    setActiveProjectId(chat.projectId || null);
    setExpandedProjectId(chat.projectId || null);
    setMessages(chat.messages || INITIAL_MESSAGES);
  }

  // ---------- DELETE CHAT ----------
  function handleDeleteChat(chatId) {
    if (!window.confirm("Delete this chat? This cannot be undone.")) return;

    setChats((prev) => {
      const remaining = prev.filter((c) => c.id !== chatId);

      if (chatId === activeChatId) {
        const sameProjectChats = remaining.filter(
          (c) => c.projectId === activeProjectId
        );

        if (sameProjectChats.length > 0) {
          const switchTo = sameProjectChats[0];
          setActiveChatId(switchTo.id);
          setMessages(switchTo.messages);
        } else if (remaining.length > 0) {
          const switchTo = remaining[0];
          setActiveChatId(switchTo.id);
          setActiveProjectId(switchTo.projectId || null);
          setExpandedProjectId(switchTo.projectId || null);
          setMessages(switchTo.messages);
        } else {
          setActiveChatId(null);
          setMessages(INITIAL_MESSAGES);
        }
      }

      return remaining;
    });
  }

  // ---------- TOGGLE PROJECT ----------
  function handleToggleProject(projectId) {
    setActiveProjectId(projectId);
    setExpandedProjectId((prev) => (prev === projectId ? null : projectId));
  }

  // ---------- FILTER ----------
  function getChatsForProject(projectId) {
    return chats.filter((chat) => chat.projectId === projectId);
  }

  const globalChats = chats.filter((chat) => !chat.projectId);

  // ---------- VIDEO PROMPT HANDLER (fal.ai) ----------
  async function handleVideoPrompt(promptText) {
    if (!token) {
      alert("Not authenticated. Please log in again.");
      return;
    }

    if (!activeChatId) {
      handleNewChat();
    }

    const userMessage = {
      role: "user",
      text: promptText,
      meta: { brand: activeBrand, mode: activeMode },
    };

    const newMessages = [...messages, userMessage];
    setMessagesAndPersist(newMessages);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt: promptText,
          aspectRatio: "16:9",
          durationSeconds: 6,
          audioEnabled: true,
          model: selectedVideoModel,
        }),
      });

      const data = await response.json();

      if (response.status === 401) {
        handleLogout();
        throw new Error("Unauthorized. Please log in again.");
      }

      if (!response.ok) {
        throw new Error(data.error || "Video request failed");
      }

      const assistantMessage = {
        role: "assistant",
        text: "Here’s your generated video:",
        type: "video",
        videoUrl: data.videoUrl || null,
      };

      setMessagesAndPersist([...newMessages, assistantMessage]);
    } catch (err) {
      console.error("Backend video error:", err);
      const errorMessage = {
        role: "assistant",
        text:
          err.message ||
          "Your backend returned an error while generating video. Check the server console for details.",
      };
      setMessagesAndPersist([...newMessages, errorMessage]);
    } finally {
      setIsSending(false);
    }
  }

  // ---------- SEND ----------
  async function handleSend(e) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!token) {
      alert("Not authenticated. Please log in again.");
      return;
    }

    // Route video prompts to fal.ai endpoint
    if (isVideoMode) {
      await handleVideoPrompt(trimmed);
      return;
    }

    if (!activeChatId) handleNewChat();

    if (!selectedModel) {
      const assistantNotice = {
        role: "assistant",
        text:
          "No model selected. Please wait for models to load or check the model loading error.",
      };
      const updated = [...messages, assistantNotice];
      setMessagesAndPersist(updated);
      return;
    }

    const userMessage = {
      role: "user",
      text: trimmed,
      meta: { brand: activeBrand, mode: activeMode },
    };

    const newMessages = [...messages, userMessage];
    setMessagesAndPersist(newMessages);
    setInput("");
    setIsSending(true);

    try {
      const endpoint =
        isImageMode && filteredModels.length > 0
          ? `${API_BASE_URL}/api/image`
          : `${API_BASE_URL}/api/ai`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt: trimmed,
          brand: activeBrand,
          mode: activeMode,
          modelId: selectedModel,
          model: selectedModel,
          clientDate: new Date().toISOString(),
        }),
      });

      const data = await response.json();

      if (response.status === 401) {
        handleLogout();
        throw new Error("Unauthorized. Please log in again.");
      }

      if (!response.ok) throw new Error(data.error || "AI request failed");

      const assistantMessage = {
        role: "assistant",
        text: data.reply,
        imageUrl: data.imageUrl || null,
      };

      setMessagesAndPersist([...newMessages, assistantMessage]);
    } catch (err) {
      console.error("Backend error:", err);

      const errorMessage = {
        role: "assistant",
        text:
          err.message ||
          "Your backend returned an error while talking to OpenRouter. Check the server console for details.",
      };

      setMessagesAndPersist([...newMessages, errorMessage]);
    } finally {
      setIsSending(false);
    }
  }

  // ---------- SEND BUTTON DISABLED STATE ----------
  const disableSend =
    isSending ||
    !input.trim() ||
    (!isVideoMode &&
      (isLoadingModels || !selectedModel || filteredModels.length === 0));

  // ---------------- LOGIN SCREEN ----------------
  if (!token) {
    return (
      <div className="min-h-screen w-full bg-[#050509] flex items-center justify-center px-4">
        <div className="w-full max-w-sm border border-zinc-800 rounded-2xl bg-[#0b0c10] px-6 py-6 shadow-xl">
          <div className="flex flex-col items-center mb-4">
            <img
              src="/byte-size-logo.png"
              alt="Byte-Size AI Logo"
              className="h-14 w-14 object-contain mb-2"
            />
            <h1 className="text-lg font-semibold text-slate-100">
              Leonard's Private AI
            </h1>
            <p className="text-xs text-zinc-400 mt-1 text-center">
              This portal is locked. Enter your access password to continue.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-3">
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-zinc-500">
                Access password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md bg-[#050509] border border-zinc-700 px-3 py-2 text-sm text-slate-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-300"
                placeholder="••••••••"
              />
            </div>

            {loginError && (
              <p className="text-xs text-red-400">{loginError}</p>
            )}

            <button
              type="submit"
              className="w-full rounded-full bg-[#130dbb] text-white font-semibold text-sm py-2 mt-1 hover:bg-[#2620e6] transition"
            >
              Unlock
            </button>
          </form>

          <p className="mt-4 text-[10px] text-zinc-500 text-center">
            LVR's AI • Private access only
          </p>
        </div>
      </div>
    );
  }

  // ---------------- MAIN APP ----------------
  return (
    <div className="min-h-screen w-full bg-[#050509] text-slate-100 flex">
      {/* inner width container */}
      <div className="flex w-full relative">
        {/* MOBILE OVERLAY */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={() => {
              setIsSidebarOpen(false);
              setIsBrandOpen(false);
              setIsModeOpen(false);
            }}
          />
        )}

        {/* SIDEBAR */}
        <aside
          className={`
          fixed inset-y-0 left-0 z-40 w-64 border-r border-zinc-800 bg-[#0b0c10]
          flex flex-col px-4 py-4 transform transition-transform duration-200
          ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
          md:static md:translate-x-0
        `}
        >
          {/* LOGO */}
          <div className="mb-6 flex items-center justify-center w-full">
            <img
              src="/byte-size-logo.png"
              alt="Byte-Size AI Logo"
              className="h-16 w-16 object-contain"
            />
          </div>

          {/* TOP NEW CHAT */}
          <button
            type="button"
            onClick={() => handleNewChat(undefined)}
            className="mb-4 inline-flex items-center justify-center gap-2 rounded-md bg-white text-black hover:bg-zinc-200 text-sm py-2 px-3 transition"
          >
            <span className="text-lg leading-none">＋</span>
            <span className="font-medium">New chat</span>
          </button>

          {/* BRAND */}
          <div className="mb-3 relative">
            <button
              type="button"
              onClick={() => {
                setIsBrandOpen((prev) => !prev);
                setIsModeOpen(false);
              }}
              className="w-full rounded-md border border-[#130dbb] bg-[#130dbb] px-3 py-2 
              text-left text-xs flex items-center justify-between hover:bg-[#2620e6] transition"
            >
              <span className="text-[11px] uppercase text-white">
                Active brand
              </span>
              <span className="text-[11px] text-white">{activeBrand}</span>
            </button>

            {isBrandOpen && (
              <div className="absolute z-50 mt-1 w-full rounded-md bg-black border border-[#130dbb] shadow-lg">
                {BRANDS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => {
                      setActiveBrand(b);
                      setIsBrandOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs border border-[#130dbb] rounded-md mb-1
                    ${
                      activeBrand === b
                        ? "bg-[#130dbb] text-white"
                        : "bg-black text-zinc-200 hover:bg-zinc-900"
                    }
                  `}
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* MODE */}
          <div className="mb-4 relative">
            <button
              type="button"
              onClick={() => {
                setIsModeOpen((prev) => !prev);
                setIsBrandOpen(false);
              }}
              className="w-full rounded-md border border-[#130dbb] bg-[#130dbb] px-3 py-2 
              text-left text-xs flex items-center justify-between hover:bg-[#2620e6] transition"
            >
              <span className="text-[11px] uppercase text-white">Mode</span>
              <span className="text-[11px] text-white">{activeMode}</span>
            </button>

            {isModeOpen && (
              <div className="absolute z-50 mt-1 w-full rounded-md bg-black border border-[#130dbb] shadow-lg">
                {MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setActiveMode(mode);
                      setIsModeOpen(false);
                      setIsSidebarOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs border border-[#130dbb] rounded-md mb-1
                    ${
                      activeMode === mode
                        ? "bg-[#130dbb] text-white"
                        : "bg-black text-zinc-200 hover:bg-zinc-900"
                    }
                  `}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* GLOBAL CHATS */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1 px-1">
              <span className="text-[11px] uppercase text-zinc-500">Chats</span>
              <button
                type="button"
                onClick={() => handleNewChat(undefined)}
                className="text-[11px] px-3 py-1 rounded-full bg-[#130dbb] text-white hover:bg-[#2620e6] transition"
              >
                + New
              </button>
            </div>

            <div className="space-y-1 pr-1 max-h-32 overflow-y-auto">
              {globalChats.map((chat) => (
                <div key={chat.id} className="flex items-center group">
                  <button
                    type="button"
                    onClick={() => handleSelectChat(chat.id)}
                    className={`flex-1 text-left px-3 py-2 rounded-md text-xs truncate transition
                    ${
                      chat.id === activeChatId
                        ? "bg-zinc-800 text-zinc-50"
                        : "text-zinc-300 hover:bg-zinc-800/50"
                    }
                  `}
                  >
                    {chat.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteChat(chat.id)}
                    className="ml-1 opacity-0 group-hover:opacity-100 text-red-500 text-[11px] hover:text-red-300 transition"
                  >
                    ✕
                  </button>
                </div>
              ))}

              {globalChats.length === 0 && (
                <p className="text-[11px] text-zinc-600 italic px-1">
                  No standalone chats yet.
                </p>
              )}
            </div>
          </div>

          {/* PROJECTS */}
          <div className="mt-2 flex-1 flex flex-col overflow-y-auto text-xs space-y-2">
            <div className="flex items-center justify-between mb-1 px-1">
              <span className="text-[11px] uppercase text-zinc-500">
                Projects
              </span>
              <button
                type="button"
                onClick={handleCreateProject}
                className="text-[11px] px-3 py-1 rounded-full bg-[#130dbb] text-white hover:bg-[#2620e6] transition"
              >
                + New
              </button>
            </div>

            <div className="space-y-2 pr-1">
              {projects.map((project) => {
                const projectChats = getChatsForProject(project.id);
                const isExpanded = expandedProjectId === project.id;

                return (
                  <div
                    key={project.id}
                    className="rounded-md bg-transparent hover:bg-zinc-900/40 transition"
                  >
                    {/* PROJECT HEADER */}
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => handleToggleProject(project.id)}
                        className={`flex-1 flex items-center justify-between px-3 py-2 text-left rounded-md text-xs
                        ${
                          project.id === activeProjectId
                            ? "bg-zinc-800 text-zinc-50"
                            : "text-zinc-300"
                        }
                      `}
                      >
                        <span className="truncate">{project.name}</span>
                        <span className="ml-2 text-[10px] text-zinc-400">
                          {isExpanded ? "▾" : "▸"}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteProject(project.id)}
                        className="ml-1 text-red-500 text-[11px] hover:text-red-300 transition px-1"
                      >
                        ✕
                      </button>
                    </div>

                    {/* CHATS WITHIN PROJECT */}
                    {isExpanded && (
                      <div className="mt-1 ml-3 border-l border-zinc-800 pl-3 space-y-1">
                        {projectChats.map((chat) => (
                          <div
                            key={chat.id}
                            className="flex items-center group"
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectChat(chat.id)}
                              className={`flex-1 text-left px-2 py-1 rounded-md text-[11px] truncate
                              ${
                                chat.id === activeChatId
                                  ? "bg-zinc-800 text-zinc-50"
                                  : "text-zinc-300 hover:bg-zinc-800/60"
                              }
                            `}
                            >
                              {chat.title}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteChat(chat.id)}
                              className="ml-1 opacity-0 group-hover:opacity-100 text-red-500 text-[11px] hover:text-red-300 transition"
                            >
                              ✕
                            </button>
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => handleNewChat(project.id)}
                          className="mt-1 inline-flex items-center text-[11px] px-3 py-1 rounded-full bg-[#130dbb] text-white hover:bg-[#2620e6] transition"
                        >
                          + New chat in {project.name}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {projects.length === 0 && (
                <p className="text-[11px] text-zinc-600 italic px-1">
                  No projects yet. Create one to group chats.
                </p>
              )}
            </div>
          </div>

          {/* LOG OUT BUTTON AT BOTTOM */}
          <div className="pt-3 border-t border-zinc-800 mt-3">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded-md bg-[#130dbb] text-white text-sm py-2 hover:bg-[#2620e6] transition"
            >
              Log out
            </button>
          </div>
        </aside>

        {/* MAIN PANEL */}
        <main className="flex-1 flex flex-col">
          {/* TOP BAR */}
          <header className="border-b border-zinc-800 px-3 md:px-6 py-3 flex items-center justify-between gap-4 bg-[#050509]/90 backdrop-blur">
            <div className="flex items-center gap-3 flex-1">
              {/* Mobile menu button */}
              <button
                className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-zinc-700 text-zinc-200 hover:bg-zinc-800/70"
                onClick={() => setIsSidebarOpen((prev) => !prev)}
              >
                <div className="space-y-1">
                  <span className="block h-[2px] w-5 bg-zinc-200" />
                  <span className="block h-[2px] w-5 bg-zinc-200" />
                  <span className="block h-[2px] w-5 bg-zinc-200" />
                </div>
              </button>

              <div className="flex flex-col">
                <div className="flex flex-wrap items-center gap-2 text-[11px] md:text-xs text-zinc-400">
                  <span>Model:</span>

                  {isVideoMode ? (
                    <>
                      <select
                        value={selectedVideoModel}
                        onChange={(e) => setSelectedVideoModel(e.target.value)}
                        className="rounded-md bg-[#050509] border border-zinc-700 px-2 py-1 text-[11px] md:text-xs text-zinc-100 focus:outline-none focus:border-zinc-300"
                      >
                        {VIDEO_MODELS.map((vm) => (
                          <option key={vm.id} value={vm.id}>
                            {vm.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-zinc-500">
                        {
                          VIDEO_MODELS.find(
                            (vm) => vm.id === selectedVideoModel
                          )?.priceLabel
                        }
                      </span>
                    </>
                  ) : (
                    <>
                      {isLoadingModels && (
                        <span className="text-emerald-400">
                          Loading models...
                        </span>
                      )}

                      {modelError && (
                        <span className="text-red-400">{modelError}</span>
                      )}

                      {!isLoadingModels &&
                        !modelError &&
                        filteredModels.length > 0 && (
                          <>
                            <select
                              value={selectedModel || ""}
                              onChange={(e) =>
                                setSelectedModel(e.target.value || null)
                              }
                              className="rounded-md bg-[#050509] border border-zinc-700 px-2 py-1 text-[11px] md:text-xs text-zinc-100 focus:outline-none focus:border-zinc-300"
                            >
                              {filteredModels.map((m) => {
                                const p = m.pricing?.prompt;
                                const c = m.pricing?.completion;
                                const paidLabel =
                                  !m.isFree && p != null && c != null
                                    ? `Paid • ${p}/${c} per 1M`
                                    : !m.isFree
                                    ? "Paid"
                                    : "Free";

                                return (
                                  <option key={m.id} value={m.id}>
                                    {m.name} ({paidLabel})
                                  </option>
                                );
                              })}
                            </select>

                            {selectedModelObj && (
                              <span className="text-zinc-500">
                                {formatPrice(selectedModelObj.pricing)}
                              </span>
                            )}
                          </>
                        )}

                      {!isLoadingModels &&
                        !modelError &&
                        filteredModels.length === 0 && (
                          <span className="text-red-400">
                            No models available for this mode.
                          </span>
                        )}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="hidden sm:block text-[11px] md:text-xs text-zinc-400 text-right">
              <span>Status:</span>
              <span className="text-emerald-400">
                {" "}
                Backend connected • Models{" "}
                {isLoadingModels ? "loading" : "ready"}
              </span>
            </div>
          </header>

          {/* CHAT AREA */}
          <section className="flex-1 flex flex-col px-3 sm:px-5 md:px-6 py-4 pb-[env(safe-area-inset-bottom)] overflow-hidden">
            {/* scrollable message area */}
            <div className="flex-1 w-full overflow-y-auto space-y-6 pb-4">
              {messages.map((msg, index) => {
                // Special case: video response
                if (msg.type === "video" && msg.videoUrl) {
                  return (
                    <div key={index} className="flex justify-start text-sm">
                      <div className="max-w-[80%] leading-relaxed whitespace-pre-wrap text-slate-100">
                        <div className="rounded-2xl px-3 py-2 bg-transparent hover:bg-zinc-900/60 transition">
                          {msg.text && <p className="mb-2">{msg.text}</p>}
                          <video
                            src={msg.videoUrl}
                            controls
                            className="mt-1 rounded-lg max-w-full"
                          />
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={index}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    } text-sm`}
                  >
                    {msg.role === "system" ? (
                      <div className="w-full text-center text-[11px] uppercase tracking-wide text-zinc-500">
                        {msg.text}
                      </div>
                    ) : (
                      <div className="max-w-[80%] leading-relaxed whitespace-pre-wrap text-slate-100">
                        <div
                          className={`rounded-2xl px-3 py-2 ${
                            msg.role === "user"
                              ? "bg-[#20212b]"
                              : "bg-transparent hover:bg-zinc-900/60 transition"
                          }`}
                        >
                          <p>{msg.text}</p>

                          {msg.imageUrl && (
                            <img
                              src={msg.imageUrl}
                              alt="Generated"
                              className="mt-2 rounded-lg max-w-full"
                            />
                          )}

                          {msg.meta && msg.role === "user" && (
                            <p className="mt-1 text-[10px] text-zinc-400">
                              {msg.meta.brand} • {msg.meta.mode}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* INPUT */}
            <form onSubmit={handleSend} className="w-full mt-2 mb-4">
              <div className="relative flex items-end">
                <textarea
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Send a message..."
                  className="w-full resize-none rounded-2xl bg-[#1c1d22] border border-zinc-700 px-4 py-3 pr-20 text-sm text-slate-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
                />

                <button
                  type="submit"
                  disabled={disableSend}
                  className={`absolute right-2 bottom-2 px-4 py-1.5 rounded-xl text-sm font-medium transition
                    ${
                      disableSend
                        ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                        : "bg-[#130dbb] text-white hover:bg-[#2620e6]"
                    }
                  `}
                >
                  {isSending ? "..." : "Send"}
                </button>
              </div>

              {selectedModelObj && !isVideoMode && (
                <p className="mt-2 text-[11px] text-zinc-500">
                  Using model:{" "}
                  <span className="text-zinc-300">{selectedModelObj.name}</span>
                </p>
              )}
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
