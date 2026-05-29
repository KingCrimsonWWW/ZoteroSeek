from pydantic import BaseModel
from typing import Dict, List, Tuple

class PromptTemplate(BaseModel):
    """Prompt template with variables"""
    name: str
    system: str
    template: str
    variables: List[str] = []
    description: str = ""

class PromptRegistry:
    """Central prompt registry"""
    
    def __init__(self):
        self._prompts: Dict[str, PromptTemplate] = {}
        self._register_defaults()
    
    def register(self, prompt: PromptTemplate):
        """Register a prompt template"""
        self._prompts[prompt.name] = prompt
    
    def get(self, name: str) -> PromptTemplate:
        """Get a prompt template"""
        if name not in self._prompts:
            raise ValueError(f"Prompt not found: {name}")
        return self._prompts[name]
    
    def render(self, name: str, **kwargs) -> Tuple[str, str]:
        """Render a prompt template with variables, returns (system, user)"""
        template = self.get(name)
        content = template.template
        for var in template.variables:
            if var in kwargs:
                content = content.replace(f"{{{var}}}", str(kwargs[var]))
        return template.system, content
    
    def list_templates(self) -> List[str]:
        """List all template names"""
        return list(self._prompts.keys())
    
    def _register_defaults(self):
        """Register default prompts"""
        self.register(PromptTemplate(
            name="rag_research",
            system="""You are ZoteroSeek, an AI research assistant. You help researchers understand academic papers.

Rules:
1. Answer based ONLY on the provided context
2. Cite sources using [^N^] format where N is the source number
3. If context doesn't contain enough info, say so honestly
4. Preserve technical terminology and mathematical notation
5. Be precise and concise""",
            template="""### Context from Papers:

{context}

### Question:
{question}

### Answer:""",
            variables=["context", "question"],
            description="Main RAG prompt for research Q&A",
        ))
        
        self.register(PromptTemplate(
            name="summarize",
            system="""You are a research assistant specializing in paper summarization.
Create clear, structured summaries that capture the key contributions.""",
            template="""### Paper:
Title: {title}
Authors: {authors}

### Content:
{content}

### Create a structured summary with:
1. **Main Contribution** (1-2 sentences)
2. **Key Methods** (bullet points)
3. **Main Results** (bullet points)
4. **Significance** (1 sentence)""",
            variables=["title", "authors", "content"],
            description="Paper summarization prompt",
        ))
