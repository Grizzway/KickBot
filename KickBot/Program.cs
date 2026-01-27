using KickBot.Core;
using DotNetEnv;

namespace KickBot;

class Program
{
    static async Task Main(string[] args)
    {
        Env.Load();

        var bot = new Bot();
        await bot.Start();

        await Task.Delay(-1);
    }
}